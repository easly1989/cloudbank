package mailingest

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Check reads the mails that arrived in every source's folder since the last
// check, keeps them in the mailbox's history, and has each read by the source
// it goes to. A folder that cannot be opened is recorded on its sources and
// does not stop the others.
func (s *Service) Check(ctx context.Context, walletID, id int64) (CheckResult, error) {
	return s.checkAndAlert(ctx, walletID, id, 0, false)
}

// CheckSource is Check for one source's folder. A folder that cannot be
// opened is an error here (ErrFolder), as well as the source's status.
func (s *Service) CheckSource(ctx context.Context, walletID, mailboxID, sourceID int64) (CheckResult, error) {
	return s.checkAndAlert(ctx, walletID, mailboxID, sourceID, false)
}

func (s *Service) checkAndAlert(ctx context.Context, walletID, id, sourceID int64, listener bool) (CheckResult, error) {
	res, mb, err := s.checkLocked(ctx, walletID, id, sourceID, listener)
	// Announced after the lock is let go, so a slow push service holds up no
	// other check.
	if res.Unrecognized > 0 {
		s.alertUnrecognized(ctx, mb, res.Unrecognized)
	}
	return res, err
}

// routed is a stored mail and the source that reads it.
type routed struct {
	id  int64
	src db.MailSource
}

// checkLocked checks the folders of the mailbox's sources, or only the one of
// sourceID when above zero, in one login. The listener's checks (listener)
// give up at once on a mailbox waiting for a new sign-in, so no source keeps
// trying a refused password.
func (s *Service) checkLocked(ctx context.Context, walletID, id, sourceID int64, listener bool) (CheckResult, db.Mailbox, error) {
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()
	// Read under the lock: a check that just finished moved the cursors.
	mb, err := s.get(ctx, walletID, id)
	if err != nil {
		return CheckResult{}, mb, err
	}
	if listener && mb.Status == StatusReauth {
		return CheckResult{}, mb, ErrReauth
	}
	sources, err := s.q.ListMailSources(ctx, id)
	if err != nil {
		return CheckResult{}, mb, err
	}
	var folders []string
	byFolder := map[string][]db.MailSource{}
	for _, src := range sources {
		if _, ok := byFolder[src.Folder]; !ok {
			folders = append(folders, src.Folder)
		}
		byFolder[src.Folder] = append(byFolder[src.Folder], src)
	}
	if sourceID > 0 {
		folders = nil
		for _, src := range sources {
			if src.ID == sourceID {
				folders = []string{src.Folder}
			}
		}
		if folders == nil {
			return CheckResult{}, mb, ErrNotFound
		}
	}

	var res CheckResult
	var read []routed
	var folderErr error
	patterns := patternCache{}
	err = s.withSession(ctx, mb, func(sess *Session) error {
		var newest string
		for _, folder := range folders {
			group := byFolder[folder]
			got, last, err := s.readFolder(ctx, sess, mb, folder, group, patterns)
			// What was stored before an error is read too: a refetch would find
			// it stored already and leave it unread.
			read = append(read, got...)
			for _, src := range group {
				s.recordSource(ctx, src, err)
			}
			if errors.Is(err, ErrFolder) {
				folderErr = err
				continue
			}
			if err != nil {
				return err
			}
			if last > newest {
				newest = last
			}
		}
		if newest != "" {
			return s.q.TouchMailboxLastMail(ctx, db.TouchMailboxLastMailParams{LastMailAt: sql.NullString{String: newest, Valid: true}, ID: id})
		}
		return nil
	})
	s.record(ctx, mb, err)
	read = lastOwner(read)
	res.New = len(read)
	// Read once the mail server is let go, also when a later folder failed:
	// the cursors of the folders before it have moved past these mails. A
	// mail stored but not read here (the process stopped) stays unrecognised,
	// and a pattern saved later can still be applied to it.
	if len(read) > 0 {
		for _, r := range read {
			m, err := s.q.GetMailMessage(ctx, db.GetMailMessageParams{ID: r.id, MailboxID: id})
			if err != nil {
				return res, mb, err
			}
			ps, err := patterns.of(ctx, s, r.src.ID)
			if err != nil {
				return res, mb, err
			}
			switch s.readMail(ctx, mb, r.src, m, ps).name {
			case OutcomeCreated:
				res.Created++
			case OutcomeUnrecognized, OutcomeUnverified:
				res.Unrecognized++
			}
		}
		if err := s.q.PruneMailMessages(ctx, db.PruneMailMessagesParams{MailboxID: id, MailboxID_2: id, Limit: int64(s.keep)}); err != nil {
			return res, mb, err
		}
	}
	if err != nil {
		return res, mb, err
	}
	if sourceID > 0 && folderErr != nil {
		return res, mb, folderErr
	}
	return res, mb, nil
}

// lastOwner keeps each mail once, with the source it went to last: a mail in
// two folders of one check, stored unclaimed from the first and taken by a
// source of the second.
func lastOwner(read []routed) []routed {
	at := map[int64]int{}
	out := read[:0]
	for _, r := range read {
		if i, ok := at[r.id]; ok {
			out[i] = r
			continue
		}
		at[r.id] = len(out)
		out = append(out, r)
	}
	return out
}

// readFolder fetches what arrived in one folder since the lowest cursor of the
// sources reading it, stores each mail for the source it goes to, and moves
// every cursor to the folder's end. It returns the stored mails and the
// arrival of the newest.
//
// A mail goes to the first source, in the mailbox's order, that claims it;
// one none claims goes to the first, as unrecognized. A source only gets the
// mails that arrived after it was added or its folder chosen. A mail already
// stored from another folder (the same Message-ID) stays where it is, unless
// it was stored unclaimed: then a source here that claims it takes it.
func (s *Service) readFolder(ctx context.Context, sess *Session, mb db.Mailbox, folder string, group []db.MailSource, patterns patternCache) ([]routed, string, error) {
	cur := lowest(group, nil)
	mails, next, err := sess.Since(folder, cur, fetchMax)
	if err == nil && next.UIDValidity != cur.UIDValidity {
		// The lowest cursor is stale (the folder was rebuilt before it was
		// read again); a source added since may still know where it was.
		v := next.UIDValidity
		if c := lowest(group, &v); c.UIDValidity == v {
			mails, next, err = sess.Since(folder, c, fetchMax)
		}
	}
	if err != nil {
		return nil, "", err
	}
	frac := s.fracOf(ctx, mb.WalletID)
	var out []routed
	var newest string
	for _, f := range mails {
		m, perr := Parse(f.Raw)
		if perr != nil {
			// Keep a trace of a mail that cannot be read, rather than moving
			// the cursor past it in silence.
			sum := sha256.Sum256(f.Raw)
			m = Message{MessageID: "sha256:" + hex.EncodeToString(sum[:]), Subject: "(unreadable mail)"}
		}
		received := m.Date
		if received.IsZero() {
			received = s.now()
		}
		var eligible []db.MailSource
		for _, src := range group {
			if uint32(src.UidValidity) == next.UIDValidity && uint32(src.LastUid) < f.UID {
				eligible = append(eligible, src)
			}
		}
		if len(eligible) == 0 {
			continue
		}
		in := mailInput{From: m.From, Subject: m.Subject, Body: m.Body, Date: received, Authenticated: m.Authenticated}
		owner, claimed, err := s.firstClaimer(ctx, eligible, patterns, in, frac)
		if err != nil {
			return out, "", err
		}
		ids, err := s.q.InsertMailMessage(ctx, db.InsertMailMessageParams{
			MailboxID: mb.ID, SourceID: sql.NullInt64{Int64: owner.ID, Valid: true}, Folder: folder,
			Uid: int64(f.UID), MessageID: m.MessageID, Sender: m.From, Subject: m.Subject,
			ReceivedAt: received.Format(time.RFC3339), Body: m.Body, Authenticated: flag(m.Authenticated),
		})
		if err != nil {
			return out, "", err
		}
		if len(ids) > 0 {
			out = append(out, routed{id: ids[0], src: owner})
			newest = received.UTC().Format(time.RFC3339)
			continue
		}
		if !claimed {
			continue
		}
		moved, err := s.secondChance(ctx, mb, m.MessageID, folder, f.UID, owner, patterns, frac)
		if err != nil {
			return out, "", err
		}
		if moved > 0 {
			out = append(out, routed{id: moved, src: owner})
		}
	}
	for _, src := range group {
		if uint32(src.UidValidity) != next.UIDValidity || uint32(src.LastUid) < next.LastUID {
			if err := s.q.SetMailSourceCursor(ctx, db.SetMailSourceCursorParams{
				UidValidity: int64(next.UIDValidity), LastUid: int64(next.LastUID), ID: src.ID,
			}); err != nil {
				return out, "", err
			}
		}
	}
	return out, newest, nil
}

// secondChance hands owner a mail already stored from another folder, when it
// was stored unclaimed: the source it went to would not read it. It returns
// the mail's id, or 0 when it stays where it is.
func (s *Service) secondChance(ctx context.Context, mb db.Mailbox, messageID, folder string, uid uint32, owner db.MailSource, patterns patternCache, frac func(int64) (int, bool)) (int64, error) {
	m, err := s.q.GetMailMessageByMessageID(ctx, db.GetMailMessageByMessageIDParams{MailboxID: mb.ID, MessageID: messageID})
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil || m.Folder == folder || m.Outcome != OutcomeUnrecognized {
		return 0, err
	}
	if m.SourceID.Valid {
		prev, err := s.q.GetMailSource(ctx, db.GetMailSourceParams{ID: m.SourceID.Int64, MailboxID: mb.ID})
		switch {
		case err == nil:
			ps, err := patterns.of(ctx, s, prev.ID)
			if err != nil {
				return 0, err
			}
			if claims(prev, ps, inputOf(m), frac) {
				return 0, nil // claimed, and read as unrecognised: final
			}
		case !errors.Is(err, sql.ErrNoRows):
			return 0, err
		}
	}
	err = s.q.MoveMailMessage(ctx, db.MoveMailMessageParams{
		SourceID: sql.NullInt64{Int64: owner.ID, Valid: true}, Folder: folder, Uid: int64(uid), ID: m.ID,
	})
	return m.ID, err
}

// lowest is the cursor of the source furthest behind, among those of the
// given UIDVALIDITY when it is not nil.
func lowest(group []db.MailSource, validity *uint32) Cursor {
	var out Cursor
	found := false
	for _, src := range group {
		c := Cursor{UIDValidity: uint32(src.UidValidity), LastUID: uint32(src.LastUid)}
		if validity != nil && c.UIDValidity != *validity {
			continue
		}
		if !found || c.LastUID < out.LastUID {
			out, found = c, true
		}
	}
	return out
}

// firstClaimer is the first of the sources that claims the mail, or the first
// of them, unclaimed.
func (s *Service) firstClaimer(ctx context.Context, sources []db.MailSource, patterns patternCache, in mailInput, frac func(int64) (int, bool)) (db.MailSource, bool, error) {
	for _, src := range sources {
		ps, err := patterns.of(ctx, s, src.ID)
		if err != nil {
			return db.MailSource{}, false, err
		}
		if claims(src, ps, in, frac) {
			return src, true, nil
		}
	}
	return sources[0], false, nil
}

// claims says whether a source would take a mail, without reading it for
// real: nothing is written and the AI is not asked. It does when one of its
// patterns reads the mail, or would but for the sender's authentication, or,
// in a mode with the AI, when the sender is one of its AI senders. In the AI
// only mode the patterns are never used, so they claim nothing. A claim is
// final: a source that claims a mail and then does not take it for a payment
// leaves it unrecognised, not offered to the next.
func claims(src db.MailSource, patterns []*compiled, in mailInput, frac func(int64) (int, bool)) bool {
	if src.AiMode != AIModeAI {
		if ev := evaluate(patterns, in, frac); ev.pattern != nil || ev.outcome == OutcomeUnverified {
			return true
		}
	}
	return src.AiMode != AIModePatterns && src.AiMode != "" && senderListed(splitSenders(src.AiSenders), in.From)
}

// patternCache holds the compiled patterns of each source a check has met.
type patternCache map[int64][]*compiled

func (c patternCache) of(ctx context.Context, s *Service, sourceID int64) ([]*compiled, error) {
	if ps, ok := c[sourceID]; ok {
		return ps, nil
	}
	ps, err := s.loadPatterns(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	c[sourceID] = ps
	return ps, nil
}

// recordSource stores how reading a source's folder went. Only a folder the
// server would not open is the source's trouble; anything else is the
// mailbox's (record) and leaves the source as it was.
func (s *Service) recordSource(ctx context.Context, src db.MailSource, err error) {
	status, detail := StatusOK, ""
	switch {
	case err == nil:
	case errors.Is(err, ErrFolder):
		status, detail = StatusError, errorText(err)
	default:
		return
	}
	_ = s.q.RecordMailSourceCheck(ctx, db.RecordMailSourceCheckParams{Status: status, StatusDetail: detail, ID: src.ID})
}
