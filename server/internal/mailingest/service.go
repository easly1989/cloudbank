// Package mailingest reads the bank's notification mails from a folder of a
// mailbox the user connects, so a card payment reaches the register before the
// bank books it (#654).
//
// A Microsoft mailbox is connected with the device-code flow (#655); the
// folder chosen is then listened to with IDLE, with a full check on a timer as
// a safety net (#656, watch.go). What arrives is kept in a short history;
// turning those mails into transactions comes with the models (#657).
package mailingest

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

var (
	// ErrUnavailable means the feature cannot run here: CB_SECRET_KEY is not
	// set, so a mailbox credential would be stored in clear.
	ErrUnavailable = errors.New("mailingest: needs CB_SECRET_KEY")
	// ErrNotFound means no such mailbox in this wallet.
	ErrNotFound = errors.New("mailingest: not found")
	// ErrFlowNotFound means the sign-in is unknown, finished, or someone
	// else's.
	ErrFlowNotFound = errors.New("mailingest: sign-in not found")
	// ErrInvalid means a request carried an unusable value.
	ErrInvalid = errors.New("mailingest: invalid input")
)

// Providers and mailbox states.
const (
	ProviderMicrosoft = "microsoft"

	StatusOK     = "ok"
	StatusError  = "error"
	StatusReauth = "reauth"

	// keepMessages is how many of the newest mails each mailbox keeps.
	keepMessages = 50
	// fetchMax is how many new mails one check reads at most.
	fetchMax = 50
)

// Mailbox is a connected mailbox as the API shows it. The credential never
// leaves the server.
type Mailbox struct {
	ID           int64   `json:"id"`
	Provider     string  `json:"provider"`
	Address      string  `json:"address"`
	Folder       string  `json:"folder"`
	Paused       bool    `json:"paused"`
	Status       string  `json:"status"`
	StatusDetail string  `json:"statusDetail"`
	LastCheckAt  *string `json:"lastCheckAt"`
	LastMailAt   *string `json:"lastMailAt"`
	CreatedAt    string  `json:"createdAt"`
	// Mode is how the listener is reading the mailbox right now: "idle" (the
	// server tells it about new mail), "polling" (it asks on a timer, for a
	// server without IDLE), "retry" (it lost the connection and waits to try
	// again), or "" when nothing is listening.
	Mode string `json:"mode"`
	// NextCheckAt is the next full check, or the next attempt while retrying.
	NextCheckAt *string `json:"nextCheckAt"`
}

// MailSummary is one mail of a mailbox's history.
type MailSummary struct {
	ID         int64  `json:"id"`
	Sender     string `json:"sender"`
	Subject    string `json:"subject"`
	ReceivedAt string `json:"receivedAt"`
	Outcome    string `json:"outcome"`
}

// Flow is a Microsoft sign-in waiting for the user.
type Flow struct {
	FlowID          string    `json:"flowId"`
	UserCode        string    `json:"userCode"`
	VerificationURI string    `json:"verificationUri"`
	ExpiresAt       time.Time `json:"expiresAt"`
	// ExpiresIn is the code's lifetime in seconds, so a browser with a wrong
	// clock can still count it down.
	ExpiresIn int `json:"expiresIn"`
	Interval  int `json:"interval"`
}

// FlowStatus is where a sign-in stands: pending, declined, expired or done,
// with the mailbox once done.
type FlowStatus struct {
	State   string   `json:"state"`
	Mailbox *Mailbox `json:"mailbox,omitempty"`
}

// CheckResult says how many new mails a check read.
type CheckResult struct {
	New int `json:"new"`
}

type flow struct {
	walletID, userID, mailboxID int64
	deviceCode                  string
	expires, nextPoll           time.Time
	interval                    time.Duration
}

type cachedToken struct {
	access string
	expiry time.Time
}

// Service owns the mailboxes and their mails.
type Service struct {
	q  *db.Queries
	rq *db.Queries
	ms *Microsoft

	// Seams for tests; production uses the secrets package, Outlook's IMAP
	// server and XOAUTH2.
	enabled   func() bool
	seal      func(string) string
	open      func(string) string
	outlook   Endpoint
	tokenAuth func(user, token string) Credentials
	now       func() time.Time
	keep      int
	timing    watchTiming
	canIdle   func(*Session) bool
	notify    Notify

	mu     sync.Mutex
	flows  map[string]*flow
	locks  map[int64]*sync.Mutex
	tokens map[int64]cachedToken
	live   map[int64]liveState
	// kick wakes the listener's supervisor when a mailbox is added, changed or
	// removed, instead of waiting for its next look.
	kick chan struct{}
}

// NewService builds the service. ms signs in to Microsoft; nil disables the
// Microsoft provider.
func NewService(read, write *sql.DB, ms *Microsoft) *Service {
	return &Service{
		q: db.New(write), rq: db.New(read), ms: ms,
		enabled: secrets.Enabled, seal: secrets.Seal, open: secrets.Open,
		outlook: OutlookEndpoint,
		tokenAuth: func(user, token string) Credentials {
			return Credentials{Username: user, AccessToken: token}
		},
		now:     time.Now,
		keep:    keepMessages,
		timing:  defaultTiming,
		canIdle: (*Session).CanIdle,
		flows:   map[string]*flow{},
		locks:   map[int64]*sync.Mutex{},
		tokens:  map[int64]cachedToken{},
		live:    map[int64]liveState{},
		kick:    make(chan struct{}, 1),
	}
}

// Available reports whether mailboxes can be connected here.
func (s *Service) Available() bool { return s.enabled() && s.ms != nil }

func (s *Service) view(m db.Mailbox) Mailbox {
	out := Mailbox{
		ID: m.ID, Provider: m.Provider, Address: m.Address, Folder: m.Folder,
		Paused: m.Paused != 0, Status: m.Status, StatusDetail: m.StatusDetail,
		CreatedAt: m.CreatedAt,
	}
	if m.LastCheckAt.Valid {
		out.LastCheckAt = &m.LastCheckAt.String
	}
	if m.LastMailAt.Valid {
		out.LastMailAt = &m.LastMailAt.String
	}
	s.mu.Lock()
	l, ok := s.live[m.ID]
	s.mu.Unlock()
	if ok {
		out.Mode = l.mode
		if !l.next.IsZero() {
			at := l.next.UTC().Format(time.RFC3339)
			out.NextCheckAt = &at
		}
	}
	return out
}

// ListMailboxes returns the wallet's mailboxes.
func (s *Service) ListMailboxes(ctx context.Context, walletID int64) ([]Mailbox, error) {
	rows, err := s.rq.ListMailboxesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Mailbox, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.view(r))
	}
	return out, nil
}

func (s *Service) get(ctx context.Context, walletID, id int64) (db.Mailbox, error) {
	m, err := s.q.GetMailbox(ctx, db.GetMailboxParams{ID: id, WalletID: walletID})
	if errors.Is(err, sql.ErrNoRows) {
		return db.Mailbox{}, ErrNotFound
	}
	return m, err
}

// StartMicrosoft begins a device-code sign-in. A mailboxID above zero signs an
// existing mailbox in again, keeping its folder and history.
func (s *Service) StartMicrosoft(ctx context.Context, walletID, userID, mailboxID int64) (Flow, error) {
	if !s.Available() {
		return Flow{}, ErrUnavailable
	}
	if mailboxID > 0 {
		if _, err := s.get(ctx, walletID, mailboxID); err != nil {
			return Flow{}, err
		}
	}
	dc, err := s.ms.StartDevice(ctx)
	if err != nil {
		return Flow{}, err
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return Flow{}, err
	}
	id := hex.EncodeToString(b)
	interval := time.Duration(max(dc.Interval, 1)) * time.Second
	now := s.now()
	f := &flow{
		walletID: walletID, userID: userID, mailboxID: mailboxID, deviceCode: dc.DeviceCode,
		expires: now.Add(time.Duration(dc.ExpiresIn) * time.Second), nextPoll: now.Add(interval),
		interval: interval,
	}
	s.mu.Lock()
	s.purgeLocked(now)
	s.flows[id] = f
	s.mu.Unlock()
	return Flow{
		FlowID: id, UserCode: dc.UserCode, VerificationURI: dc.VerificationURI,
		ExpiresAt: f.expires.UTC(), ExpiresIn: dc.ExpiresIn, Interval: int(interval / time.Second),
	}, nil
}

// PollMicrosoft checks a sign-in. It asks Microsoft at most once per interval,
// so a browser that polls faster just hears "pending".
func (s *Service) PollMicrosoft(ctx context.Context, walletID, userID int64, flowID string) (FlowStatus, error) {
	s.mu.Lock()
	f, ok := s.flows[flowID]
	if !ok || f.walletID != walletID || f.userID != userID {
		s.mu.Unlock()
		return FlowStatus{}, ErrFlowNotFound
	}
	now := s.now()
	if now.After(f.expires) {
		s.purgeLocked(now)
		s.mu.Unlock()
		return FlowStatus{State: PollExpired.String()}, nil
	}
	if now.Before(f.nextPoll) {
		s.mu.Unlock()
		return FlowStatus{State: PollPending.String()}, nil
	}
	f.nextPoll = now.Add(f.interval)
	s.mu.Unlock()

	state, tok, err := s.ms.PollDevice(ctx, f.deviceCode)
	if err != nil {
		return FlowStatus{}, err
	}
	switch state {
	case PollSlowDown:
		s.mu.Lock()
		f.interval += 5 * time.Second
		f.nextPoll = now.Add(f.interval)
		s.mu.Unlock()
		return FlowStatus{State: PollPending.String()}, nil
	case PollPending:
		return FlowStatus{State: PollPending.String()}, nil
	case PollDeclined, PollExpired:
		s.forget(flowID)
		return FlowStatus{State: state.String()}, nil
	}
	s.forget(flowID)
	if tok.Email == "" {
		return FlowStatus{}, errors.New("mailingest: microsoft did not say which mailbox this is")
	}
	mb, err := s.saveMicrosoft(ctx, f, tok)
	if err != nil {
		return FlowStatus{}, err
	}
	return FlowStatus{State: PollDone.String(), Mailbox: &mb}, nil
}

// purgeLocked drops the sign-ins whose code has expired. The caller holds mu.
func (s *Service) purgeLocked(now time.Time) {
	for k, f := range s.flows {
		if now.After(f.expires) {
			delete(s.flows, k)
		}
	}
}

func (s *Service) forget(flowID string) {
	s.mu.Lock()
	delete(s.flows, flowID)
	s.mu.Unlock()
}

// saveMicrosoft stores the signed-in mailbox: a new one, or new credentials
// for one the wallet already has. A new mailbox's cursor starts at the end of
// its inbox, so only what arrives from now on is read.
func (s *Service) saveMicrosoft(ctx context.Context, f *flow, tok Token) (Mailbox, error) {
	if !s.enabled() {
		return Mailbox{}, ErrUnavailable
	}
	var mb db.Mailbox
	var err error
	existing := f.mailboxID
	if existing == 0 {
		found, ferr := s.q.FindMailboxByAddress(ctx, db.FindMailboxByAddressParams{
			WalletID: f.walletID, Provider: ProviderMicrosoft, Address: strings.ToLower(tok.Email),
		})
		if ferr == nil {
			existing = found.ID
		} else if !errors.Is(ferr, sql.ErrNoRows) {
			return Mailbox{}, ferr
		}
	}
	if existing > 0 {
		if mb, err = s.get(ctx, f.walletID, existing); err != nil {
			return Mailbox{}, err
		}
		if err := s.q.SetMailboxSecret(ctx, db.SetMailboxSecretParams{Secret: s.seal(tok.RefreshToken), ID: mb.ID}); err != nil {
			return Mailbox{}, err
		}
	} else {
		mb, err = s.q.InsertMailbox(ctx, db.InsertMailboxParams{
			WalletID: f.walletID, CreatedBy: sql.NullInt64{Int64: f.userID, Valid: f.userID > 0},
			Provider: ProviderMicrosoft, Address: strings.ToLower(tok.Email), Secret: s.seal(tok.RefreshToken),
		})
		if err != nil {
			return Mailbox{}, err
		}
	}
	s.mu.Lock()
	s.tokens[mb.ID] = cachedToken{access: tok.AccessToken, expiry: s.now().Add(tok.ExpiresIn)}
	s.mu.Unlock()

	// Start reading at the folder's end (a new mailbox), or just prove the new
	// credentials work (a sign-in again).
	lock := s.lockFor(mb.ID)
	lock.Lock()
	defer lock.Unlock()
	err = s.withSession(ctx, mb, func(sess *Session) error {
		if mb.UidValidity != 0 {
			return nil
		}
		cur, err := sess.End(mb.Folder)
		if err != nil {
			return err
		}
		return s.q.SetMailboxCursor(ctx, db.SetMailboxCursorParams{
			UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID), ID: mb.ID,
		})
	})
	s.record(ctx, mb, err)
	s.wake()
	return s.reload(ctx, f.walletID, mb.ID)
}

func (s *Service) reload(ctx context.Context, walletID, id int64) (Mailbox, error) {
	m, err := s.get(ctx, walletID, id)
	if err != nil {
		return Mailbox{}, err
	}
	return s.view(m), nil
}

func (s *Service) lockFor(id int64) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.locks[id]
	if !ok {
		l = &sync.Mutex{}
		s.locks[id] = l
	}
	return l
}

// accessToken returns a valid access token for a Microsoft mailbox, renewing
// it with the stored refresh token when needed. Microsoft rotates the refresh
// token; the new one replaces the old, sealed.
func (s *Service) accessToken(ctx context.Context, mb db.Mailbox) (string, error) {
	s.mu.Lock()
	c, ok := s.tokens[mb.ID]
	s.mu.Unlock()
	if ok && s.now().Add(2*time.Minute).Before(c.expiry) {
		return c.access, nil
	}
	if !s.enabled() {
		return "", ErrUnavailable
	}
	tok, err := s.ms.Refresh(ctx, s.open(mb.Secret))
	if err != nil {
		return "", err
	}
	if err := s.q.SetMailboxSecret(ctx, db.SetMailboxSecretParams{Secret: s.seal(tok.RefreshToken), ID: mb.ID}); err != nil {
		return "", err
	}
	s.mu.Lock()
	s.tokens[mb.ID] = cachedToken{access: tok.AccessToken, expiry: s.now().Add(tok.ExpiresIn)}
	s.mu.Unlock()
	return tok.AccessToken, nil
}

// withSession logs in to the mailbox and runs fn. The caller holds the
// mailbox's lock, so two checks never race on the cursor or the token.
func (s *Service) withSession(ctx context.Context, mb db.Mailbox, fn func(*Session) error) error {
	if mb.Provider != ProviderMicrosoft || s.ms == nil {
		return fmt.Errorf("%w: unknown provider %q", ErrInvalid, mb.Provider)
	}
	sess, err := s.login(ctx, mb, func(cred Credentials) (*Session, error) {
		return Connect(ctx, s.outlook, cred)
	})
	if err != nil {
		return err
	}
	defer sess.Close()
	return fn(sess)
}

// login connects with the mailbox's access token. A refused token is most
// likely a stale cached one, so it is dropped and the login tried once more
// with a fresh one before the refusal counts.
func (s *Service) login(ctx context.Context, mb db.Mailbox, connect func(Credentials) (*Session, error)) (*Session, error) {
	for attempt := 0; ; attempt++ {
		token, err := s.accessToken(ctx, mb)
		if err != nil {
			return nil, err
		}
		sess, err := connect(s.tokenAuth(mb.Address, token))
		if err == nil || !errors.Is(err, ErrLogin) || attempt > 0 {
			return sess, err
		}
		s.mu.Lock()
		delete(s.tokens, mb.ID)
		s.mu.Unlock()
	}
}

// record stores the outcome of talking to the mailbox. A refused sign-in also
// tells the person who connected it, once, until a check works again.
func (s *Service) record(ctx context.Context, mb db.Mailbox, err error) {
	status, detail := StatusOK, ""
	switch {
	case err == nil:
	case errors.Is(err, ErrReauth):
		status, detail = StatusReauth, "sign in to Microsoft again"
	default:
		status, detail = StatusError, err.Error()
	}
	_ = s.q.RecordMailboxCheck(ctx, db.RecordMailboxCheckParams{Status: status, StatusDetail: detail, ID: mb.ID})
	switch {
	case err == nil:
		_, _ = s.q.SetMailboxAlerted(ctx, db.SetMailboxAlertedParams{Alerted: 0, ID: mb.ID, Alerted_2: 0})
	case errors.Is(err, ErrReauth) || errors.Is(err, ErrLogin):
		n, aerr := s.q.SetMailboxAlerted(ctx, db.SetMailboxAlertedParams{Alerted: 1, ID: mb.ID, Alerted_2: 1})
		if aerr == nil && n > 0 {
			s.alertStopped(ctx, mb)
		}
	}
}

// Folders lists the folders of a mailbox.
func (s *Service) Folders(ctx context.Context, walletID, id int64) ([]string, error) {
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()
	// Read under the lock: a check may just have rotated the credential.
	mb, err := s.get(ctx, walletID, id)
	if err != nil {
		return nil, err
	}
	var out []string
	err = s.withSession(ctx, mb, func(sess *Session) error {
		var ferr error
		out, ferr = sess.Folders()
		return ferr
	})
	if err != nil {
		s.record(ctx, mb, err)
		return nil, err
	}
	return out, nil
}

// Update changes a mailbox's folder or pauses it. A new folder is read from
// its current end, like a new mailbox.
func (s *Service) Update(ctx context.Context, walletID, id int64, folder *string, paused *bool) (Mailbox, error) {
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()
	// Read under the lock: a check may just have rotated the credential.
	mb, err := s.get(ctx, walletID, id)
	if err != nil {
		return Mailbox{}, err
	}
	if folder != nil && strings.TrimSpace(*folder) != mb.Folder {
		name := strings.TrimSpace(*folder)
		if name == "" {
			return Mailbox{}, ErrInvalid
		}
		err := s.withSession(ctx, mb, func(sess *Session) error {
			cur, err := sess.End(name)
			if err != nil {
				return fmt.Errorf("%w: %v", ErrInvalid, err)
			}
			return s.q.SetMailboxFolder(ctx, db.SetMailboxFolderParams{
				Folder: name, UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID), ID: id,
			})
		})
		if err != nil {
			if !errors.Is(err, ErrInvalid) {
				s.record(ctx, mb, err)
			}
			return Mailbox{}, err
		}
	}
	if paused != nil {
		v := int64(0)
		if *paused {
			v = 1
		}
		if err := s.q.SetMailboxPaused(ctx, db.SetMailboxPausedParams{Paused: v, ID: id}); err != nil {
			return Mailbox{}, err
		}
	}
	s.wake()
	return s.reload(ctx, walletID, id)
}

// Remove disconnects a mailbox. Its credential and its mails go with it.
func (s *Service) Remove(ctx context.Context, walletID, id int64) error {
	n, err := s.q.DeleteMailbox(ctx, db.DeleteMailboxParams{ID: id, WalletID: walletID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.mu.Lock()
	delete(s.tokens, id)
	delete(s.locks, id)
	s.mu.Unlock()
	s.wake()
	return nil
}

// Check reads the mails that arrived in the mailbox's folder since the last
// check, and keeps them in its history.
func (s *Service) Check(ctx context.Context, walletID, id int64) (CheckResult, error) {
	res, mb, err := s.checkLocked(ctx, walletID, id)
	if err != nil {
		return CheckResult{}, err
	}
	// Until the models (#657) read them, every new mail is one CloudBank did
	// not recognise. Announced after the lock is let go, so a slow push
	// service holds up no other check.
	if res.New > 0 {
		s.alertUnrecognized(ctx, mb, res.New)
	}
	return res, nil
}

func (s *Service) checkLocked(ctx context.Context, walletID, id int64) (CheckResult, db.Mailbox, error) {
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()
	// Read under the lock: a check that just finished moved the cursor.
	mb, err := s.get(ctx, walletID, id)
	if err != nil {
		return CheckResult{}, mb, err
	}
	var res CheckResult
	err = s.withSession(ctx, mb, func(sess *Session) error {
		cur := Cursor{UIDValidity: uint32(mb.UidValidity), LastUID: uint32(mb.LastUid)}
		mails, next, err := sess.Since(mb.Folder, cur, fetchMax)
		if err != nil {
			return err
		}
		var newest string
		for _, f := range mails {
			m, perr := Parse(f.Raw)
			if perr != nil {
				// Keep a trace of a mail that cannot be read, rather than
				// moving the cursor past it in silence.
				sum := sha256.Sum256(f.Raw)
				m = Message{MessageID: "sha256:" + hex.EncodeToString(sum[:]), Subject: "(unreadable mail)"}
			}
			received := m.Date
			if received.IsZero() {
				received = s.now()
			}
			at := received.Format(time.RFC3339)
			n, ierr := s.q.InsertMailMessage(ctx, db.InsertMailMessageParams{
				MailboxID: id, Uid: int64(f.UID), MessageID: m.MessageID, Sender: m.From,
				Subject: m.Subject, ReceivedAt: at, Body: m.Body,
			})
			if ierr != nil {
				return ierr
			}
			if n > 0 {
				res.New++
				newest = received.UTC().Format(time.RFC3339)
			}
		}
		if res.New > 0 {
			if err := s.q.PruneMailMessages(ctx, db.PruneMailMessagesParams{MailboxID: id, MailboxID_2: id, Limit: int64(s.keep)}); err != nil {
				return err
			}
			if err := s.q.TouchMailboxLastMail(ctx, db.TouchMailboxLastMailParams{LastMailAt: sql.NullString{String: newest, Valid: true}, ID: id}); err != nil {
				return err
			}
		}
		if next != cur {
			return s.q.SetMailboxCursor(ctx, db.SetMailboxCursorParams{
				UidValidity: int64(next.UIDValidity), LastUid: int64(next.LastUID), ID: id,
			})
		}
		return nil
	})
	s.record(ctx, mb, err)
	return res, mb, err
}

// Messages returns the mailbox's history, newest first.
func (s *Service) Messages(ctx context.Context, walletID, id int64) ([]MailSummary, error) {
	if _, err := s.get(ctx, walletID, id); err != nil {
		return nil, err
	}
	rows, err := s.rq.ListMailMessages(ctx, db.ListMailMessagesParams{MailboxID: id, Limit: int64(s.keep)})
	if err != nil {
		return nil, err
	}
	out := make([]MailSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, MailSummary{ID: r.ID, Sender: r.Sender, Subject: r.Subject, ReceivedAt: r.ReceivedAt, Outcome: r.Outcome})
	}
	return out, nil
}
