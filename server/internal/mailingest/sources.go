package mailingest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// maxSources is how many sources a mailbox can have, each on its own
// connection: mail servers limit how many one account may keep open.
const maxSources = 5

var (
	// ErrSourceLimit means the mailbox has maxSources sources already.
	ErrSourceLimit = errors.New("mailingest: a mailbox has at most 5 sources")
	// ErrSourceNameTaken means another source of the mailbox has the name.
	ErrSourceNameTaken = errors.New("mailingest: another source has this name")
	// ErrLastSource means the source is the mailbox's only one.
	ErrLastSource = errors.New("mailingest: a mailbox keeps at least one source")
)

// getSource finds a source of a mailbox of the wallet.
func (s *Service) getSource(ctx context.Context, walletID, mailboxID, sourceID int64) (db.Mailbox, db.MailSource, error) {
	mb, err := s.get(ctx, walletID, mailboxID)
	if err != nil {
		return mb, db.MailSource{}, err
	}
	src, err := s.q.GetMailSource(ctx, db.GetMailSourceParams{ID: sourceID, MailboxID: mailboxID})
	if errors.Is(err, sql.ErrNoRows) {
		return mb, src, ErrNotFound
	}
	return mb, src, err
}

func (s *Service) reloadSource(ctx context.Context, mailboxID, sourceID int64) (Source, error) {
	src, err := s.q.GetMailSource(ctx, db.GetMailSourceParams{ID: sourceID, MailboxID: mailboxID})
	if err != nil {
		return Source{}, err
	}
	return s.sourceView(src), nil
}

// sourceName checks a source's name: trimmed, not empty, and no other source
// of the mailbox (but self) has it, whatever the case.
func sourceName(name string, sources []db.MailSource, self int64) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("%w: the name is required", ErrInvalid)
	}
	for _, o := range sources {
		if o.ID != self && strings.EqualFold(o.Name, name) {
			return "", ErrSourceNameTaken
		}
	}
	return name, nil
}

// folderEnd logs in and returns a cursor at the folder's end. A folder the
// server would not open is a bad request; anything else is recorded on the
// mailbox, like any other failed login. The caller holds the mailbox's lock.
func (s *Service) folderEnd(ctx context.Context, mb db.Mailbox, folder string) (Cursor, error) {
	folder = strings.TrimSpace(folder)
	if folder == "" {
		return Cursor{}, fmt.Errorf("%w: the folder is required", ErrInvalid)
	}
	var cur Cursor
	err := s.withSession(ctx, mb, func(sess *Session) error {
		var err error
		cur, err = sess.End(folder)
		return err
	})
	if errors.Is(err, ErrFolder) {
		return Cursor{}, fmt.Errorf("%w: %s", ErrInvalid, errorText(err))
	}
	if err != nil {
		s.record(ctx, mb, err)
	}
	return cur, err
}

// CreateSource adds a source reading folder, from its current end, at the end
// of the mailbox's list, with no patterns and the patterns-only mode.
func (s *Service) CreateSource(ctx context.Context, walletID, mailboxID int64, name, folder string) (Source, error) {
	lock := s.lockFor(mailboxID)
	lock.Lock()
	defer lock.Unlock()
	mb, err := s.get(ctx, walletID, mailboxID)
	if err != nil {
		return Source{}, err
	}
	sources, err := s.q.ListMailSources(ctx, mailboxID)
	if err != nil {
		return Source{}, err
	}
	if len(sources) >= maxSources {
		return Source{}, ErrSourceLimit
	}
	if name, err = sourceName(name, sources, 0); err != nil {
		return Source{}, err
	}
	folder = strings.TrimSpace(folder)
	cur, err := s.folderEnd(ctx, mb, folder)
	if err != nil {
		return Source{}, err
	}
	row, err := s.q.InsertMailSource(ctx, db.InsertMailSourceParams{
		MailboxID: mailboxID, Name: name, Folder: folder,
		UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID),
	})
	if err != nil {
		return Source{}, err
	}
	s.wake()
	return s.sourceView(row), nil
}

// UpdateSource renames a source or gives it another folder, read from its
// current end like a new source.
func (s *Service) UpdateSource(ctx context.Context, walletID, mailboxID, sourceID int64, name, folder *string) (Source, error) {
	lock := s.lockFor(mailboxID)
	lock.Lock()
	defer lock.Unlock()
	mb, src, err := s.getSource(ctx, walletID, mailboxID, sourceID)
	if err != nil {
		return Source{}, err
	}
	if name != nil {
		sources, err := s.q.ListMailSources(ctx, mailboxID)
		if err != nil {
			return Source{}, err
		}
		n, err := sourceName(*name, sources, src.ID)
		if err != nil {
			return Source{}, err
		}
		name = &n
	}
	if folder != nil && strings.TrimSpace(*folder) != src.Folder {
		f := strings.TrimSpace(*folder)
		cur, err := s.folderEnd(ctx, mb, f)
		if err != nil {
			return Source{}, err
		}
		if err := s.q.SetMailSourceFolder(ctx, db.SetMailSourceFolderParams{
			Folder: f, UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID), ID: src.ID,
		}); err != nil {
			return Source{}, err
		}
		s.wake()
	}
	if name != nil && *name != src.Name {
		if err := s.q.SetMailSourceName(ctx, db.SetMailSourceNameParams{Name: *name, ID: src.ID}); err != nil {
			return Source{}, err
		}
	}
	return s.reloadSource(ctx, mailboxID, src.ID)
}

// DeleteSource removes a source and its patterns. Its mails stay in the
// mailbox's history, without a source. The last source stays.
func (s *Service) DeleteSource(ctx context.Context, walletID, mailboxID, sourceID int64) error {
	lock := s.lockFor(mailboxID)
	lock.Lock()
	defer lock.Unlock()
	if _, _, err := s.getSource(ctx, walletID, mailboxID, sourceID); err != nil {
		return err
	}
	sources, err := s.q.ListMailSources(ctx, mailboxID)
	if err != nil {
		return err
	}
	if len(sources) <= 1 {
		return ErrLastSource
	}
	if _, err := s.q.DeleteMailSource(ctx, db.DeleteMailSourceParams{ID: sourceID, MailboxID: mailboxID}); err != nil {
		return err
	}
	s.wake()
	return nil
}

// ReorderSources puts the mailbox's sources in the given order, which must
// name each of them once: a mail two sources would read goes to the first.
func (s *Service) ReorderSources(ctx context.Context, walletID, mailboxID int64, ids []int64) (Mailbox, error) {
	lock := s.lockFor(mailboxID)
	lock.Lock()
	defer lock.Unlock()
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return Mailbox{}, err
	}
	sources, err := s.q.ListMailSources(ctx, mailboxID)
	if err != nil {
		return Mailbox{}, err
	}
	known := map[int64]bool{}
	for _, src := range sources {
		known[src.ID] = true
	}
	if len(ids) != len(sources) {
		return Mailbox{}, fmt.Errorf("%w: the order must name every source once", ErrInvalid)
	}
	for _, id := range ids {
		if !known[id] {
			return Mailbox{}, fmt.Errorf("%w: the order must name every source once", ErrInvalid)
		}
		delete(known, id)
	}
	for i, id := range ids {
		if err := s.q.SetMailSourcePosition(ctx, db.SetMailSourcePositionParams{Position: int64(i), ID: id, MailboxID: mailboxID}); err != nil {
			return Mailbox{}, err
		}
	}
	return s.reload(ctx, walletID, mailboxID)
}
