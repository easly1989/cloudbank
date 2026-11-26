// Package mailingest reads the bank's notification mails from a folder of a
// mailbox the user connects, so a card payment reaches the register before the
// bank books it (#654).
//
// A Microsoft mailbox is connected with the device-code flow (#655). Each of
// its sources, a folder with its own patterns and AI settings (#794,
// sources.go), is then listened to with IDLE, with a full check on a timer as
// a safety net (#656, watch.go). What arrives is kept in a short history and
// read by the first source that claims it (check.go), whose patterns turn a
// bank's mail into a transaction (#657, pattern.go and ingest.go).
package mailingest

import (
	"context"
	"crypto/rand"
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
	ProviderIMAP      = "imap"

	StatusOK     = "ok"
	StatusError  = "error"
	StatusReauth = "reauth"

	// keepMessages is how many of the newest mails each mailbox keeps.
	keepMessages = 50
	// fetchMax is how many new mails one check reads at most.
	fetchMax = 50
)

// Mailbox is a connected mailbox as the API shows it. The credential never
// leaves the server. Its status is the connection's and the login's; a folder
// that cannot be read is its source's.
type Mailbox struct {
	ID           int64   `json:"id"`
	Provider     string  `json:"provider"`
	Address      string  `json:"address"`
	Paused       bool    `json:"paused"`
	Status       string  `json:"status"`
	StatusDetail string  `json:"statusDetail"`
	LastCheckAt  *string `json:"lastCheckAt"`
	LastMailAt   *string `json:"lastMailAt"`
	CreatedAt    string  `json:"createdAt"`
	// IMAP is where an IMAP mailbox's server is; nil for Microsoft.
	IMAP *IMAPSettings `json:"imap"`
	// AIReady says whether a source can use the AI (#659): whoever connected
	// the mailbox has AI set up.
	AIReady bool `json:"aiReady"`
	// Sources are the mailbox's folders, in the order a mail is offered to
	// them (#794).
	Sources []Source `json:"sources"`
}

// Source is one folder of a mailbox, read with its own patterns and AI
// settings, and listened to on its own connection (#794).
type Source struct {
	ID        int64    `json:"id"`
	MailboxID int64    `json:"mailboxId"`
	Position  int      `json:"position"`
	Name      string   `json:"name"`
	Folder    string   `json:"folder"`
	AI        SourceAI `json:"ai"`
	// Status is "error" when the folder cannot be opened (deleted or
	// renamed), with the server's words in StatusDetail.
	Status       string  `json:"status"`
	StatusDetail string  `json:"statusDetail"`
	LastCheckAt  *string `json:"lastCheckAt"`
	// Mode is how the listener is reading the folder right now: "idle" (the
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
	// Outcome is what became of the mail (the Outcome constants); Detail says
	// why one failed.
	Outcome       string `json:"outcome"`
	Detail        string `json:"detail"`
	Authenticated bool   `json:"authenticated"`
	PatternID     *int64 `json:"patternId"`
	// TransactionID and AccountID lead to the transaction the mail made, or
	// the one it duplicates, while it exists.
	TransactionID *int64 `json:"transactionId"`
	AccountID     *int64 `json:"accountId"`
	// Amount, Memo and Payee are that transaction's, as the register has
	// them now.
	Amount *int64  `json:"amount"`
	Memo   *string `json:"memo"`
	Payee  *string `json:"payee"`
	// ByAI says the AI, not a pattern, read the mail.
	ByAI bool `json:"byAi"`
	// SourceID and SourceName are the source that read it; nil once that
	// source is removed.
	SourceID   *int64  `json:"sourceId"`
	SourceName *string `json:"sourceName"`
}

// MailDetail is one mail with its text, for the pattern editor.
type MailDetail struct {
	MailSummary
	Body string `json:"body"`
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

// CheckResult says how many new mails a check read, how many became
// transactions, and how many no pattern read.
type CheckResult struct {
	New          int `json:"new"`
	Created      int `json:"created"`
	Unrecognized int `json:"unrecognized"`
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
	w  *sql.DB
	q  *db.Queries
	rq *db.Queries
	ms *Microsoft

	// Seams for tests; production uses the secrets package, Outlook's IMAP
	// server and XOAUTH2.
	enabled   func() bool
	seal      func(string) string
	open      func(string) string
	outlook   Endpoint
	localIMAP string
	tokenAuth func(user, token string) Credentials
	now       func() time.Time
	keep      int
	timing    watchTiming
	canIdle   func(*Session) bool
	notify    Notify
	importer  Importer
	reader    AIReader

	mu     sync.Mutex
	flows  map[string]*flow
	locks  map[int64]*sync.Mutex
	tokens map[int64]cachedToken
	// live is what the listener does for each source, by source id.
	live map[int64]liveState
	// kick wakes the listener's supervisor when a mailbox or a source is
	// added, changed or removed, instead of waiting for its next look.
	kick chan struct{}
}

// NewService builds the service. ms signs in to Microsoft; nil disables the
// Microsoft provider.
func NewService(read, write *sql.DB, ms *Microsoft) *Service {
	return &Service{
		w: write, q: db.New(write), rq: db.New(read), ms: ms,
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

// SetOutlook reaches Outlook.com mailboxes at ep instead of Microsoft's IMAP
// server: the end-to-end tests' pretend one.
func (s *Service) SetOutlook(ep Endpoint) { s.outlook = ep }

// Available reports whether mailboxes can be connected here.
func (s *Service) Available() bool { return s.enabled() }

// MicrosoftAvailable reports whether Outlook.com mailboxes can be connected:
// it also needs an application id to sign in to Microsoft with.
func (s *Service) MicrosoftAvailable() bool { return s.enabled() && s.ms != nil }

func (s *Service) view(ctx context.Context, m db.Mailbox) (Mailbox, error) {
	out := Mailbox{
		ID: m.ID, Provider: m.Provider, Address: m.Address,
		Paused: m.Paused != 0, Status: m.Status, StatusDetail: m.StatusDetail,
		CreatedAt: m.CreatedAt, IMAP: imapSettings(m), AIReady: s.aiReady(ctx, m),
		LastCheckAt: nullText(m.LastCheckAt), LastMailAt: nullText(m.LastMailAt),
	}
	rows, err := s.q.ListMailSources(ctx, m.ID)
	if err != nil {
		return Mailbox{}, err
	}
	out.Sources = make([]Source, 0, len(rows))
	for _, r := range rows {
		out.Sources = append(out.Sources, s.sourceView(r))
	}
	return out, nil
}

func (s *Service) sourceView(r db.MailSource) Source {
	out := Source{
		ID: r.ID, MailboxID: r.MailboxID, Position: int(r.Position), Name: r.Name, Folder: r.Folder,
		AI: aiOf(r), Status: r.Status, StatusDetail: r.StatusDetail, LastCheckAt: nullText(r.LastCheckAt),
	}
	s.mu.Lock()
	l, ok := s.live[r.ID]
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
		mb, err := s.view(ctx, r)
		if err != nil {
			return nil, err
		}
		out = append(out, mb)
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
	if !s.MicrosoftAvailable() {
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
		// The inbox's cursor is set once logged in, below; until then a check
		// finds it stale and starts at the folder's end all the same.
		mb, err = s.insertMailbox(ctx, Cursor{}, func(q *db.Queries) (db.Mailbox, error) {
			return q.InsertMailbox(ctx, db.InsertMailboxParams{
				WalletID: f.walletID, CreatedBy: sql.NullInt64{Int64: f.userID, Valid: f.userID > 0},
				Provider: ProviderMicrosoft, Address: strings.ToLower(tok.Email), Secret: s.seal(tok.RefreshToken),
			})
		})
		if err != nil {
			return Mailbox{}, err
		}
	}
	s.mu.Lock()
	s.tokens[mb.ID] = cachedToken{access: tok.AccessToken, expiry: s.now().Add(tok.ExpiresIn)}
	s.mu.Unlock()

	// Start reading at the inbox's end (a new mailbox), or just prove the new
	// credentials work (a sign-in again).
	lock := s.lockFor(mb.ID)
	lock.Lock()
	defer lock.Unlock()
	err = s.withSession(ctx, mb, func(sess *Session) error {
		if existing > 0 {
			return nil
		}
		srcs, err := s.q.ListMailSources(ctx, mb.ID)
		if err != nil || len(srcs) == 0 {
			return err
		}
		cur, err := sess.End(srcs[0].Folder)
		if err != nil {
			return err
		}
		return s.q.SetMailSourceCursor(ctx, db.SetMailSourceCursorParams{
			UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID), ID: srcs[0].ID,
		})
	})
	s.record(ctx, mb, err)
	s.wake()
	return s.reload(ctx, f.walletID, mb.ID)
}

// firstSource is the source every new mailbox starts with.
const firstSource = "INBOX"

// insertMailbox stores a new mailbox, made by insert, with its first source
// reading the inbox from cur, in one transaction: a mailbox is never without
// a source.
func (s *Service) insertMailbox(ctx context.Context, cur Cursor, insert func(*db.Queries) (db.Mailbox, error)) (db.Mailbox, error) {
	tx, err := s.w.BeginTx(ctx, nil)
	if err != nil {
		return db.Mailbox{}, err
	}
	defer func() { _ = tx.Rollback() }()
	q := s.q.WithTx(tx)
	mb, err := insert(q)
	if err != nil {
		return db.Mailbox{}, err
	}
	if _, err := q.InsertMailSource(ctx, db.InsertMailSourceParams{
		MailboxID: mb.ID, Name: firstSource, Folder: firstSource,
		UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID),
	}); err != nil {
		return db.Mailbox{}, err
	}
	return mb, tx.Commit()
}

func (s *Service) reload(ctx context.Context, walletID, id int64) (Mailbox, error) {
	m, err := s.get(ctx, walletID, id)
	if err != nil {
		return Mailbox{}, err
	}
	return s.view(ctx, m)
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
	sess, err := s.connectTo(ctx, mb, func(ep Endpoint, cred Credentials) (*Session, error) {
		return Connect(ctx, ep, cred)
	})
	if err != nil {
		return err
	}
	defer sess.Close()
	return fn(sess)
}

// connectTo logs in to the mailbox with its stored credential, through
// connect: a plain session or a listening one.
func (s *Service) connectTo(ctx context.Context, mb db.Mailbox, connect func(Endpoint, Credentials) (*Session, error)) (*Session, error) {
	switch {
	case !s.enabled():
		return nil, ErrUnavailable
	case mb.Provider == ProviderIMAP:
		return s.imapLogin(mb, connect)
	case mb.Provider == ProviderMicrosoft && s.ms != nil:
		return s.login(ctx, mb, func(cred Credentials) (*Session, error) {
			return connect(s.outlook, cred)
		})
	case mb.Provider == ProviderMicrosoft:
		return nil, ErrUnavailable
	}
	return nil, fmt.Errorf("%w: unknown provider %q", ErrInvalid, mb.Provider)
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

// record stores the outcome of talking to the mailbox: the connection and the
// login. A folder the server would not open means the login worked; it is the
// trouble of the sources reading it (recordSource). A refused sign-in also
// tells the person who connected it, once, until a check works again, and
// stops every source's listener at once.
func (s *Service) record(ctx context.Context, mb db.Mailbox, err error) {
	if errors.Is(err, ErrFolder) {
		err = nil
	}
	status, detail := StatusOK, ""
	switch {
	case err == nil:
	case errors.Is(err, ErrReauth):
		status, detail = StatusReauth, "sign in to Microsoft again"
		if le := new(LoginError); errors.As(err, &le) {
			detail = "the mail server refused the app password: " + le.Text
		}
	default:
		status, detail = StatusError, err.Error()
	}
	_ = s.q.RecordMailboxCheck(ctx, db.RecordMailboxCheckParams{Status: status, StatusDetail: detail, ID: mb.ID})
	if status == StatusReauth {
		s.wake()
	}
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

// Update pauses or resumes a mailbox, every source with it.
func (s *Service) Update(ctx context.Context, walletID, id int64, paused *bool) (Mailbox, error) {
	if _, err := s.get(ctx, walletID, id); err != nil {
		return Mailbox{}, err
	}
	if paused != nil {
		if err := s.q.SetMailboxPaused(ctx, db.SetMailboxPausedParams{Paused: flag(*paused), ID: id}); err != nil {
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
		out = append(out, MailSummary{
			ID: r.ID, Sender: r.Sender, Subject: r.Subject, ReceivedAt: r.ReceivedAt,
			Outcome: r.Outcome, Detail: r.Detail, Authenticated: r.Authenticated != 0,
			PatternID: nullID(r.PatternID), TransactionID: nullID(r.TransactionID), AccountID: nullID(r.AccountID),
			Amount: nullID(r.TransactionAmount), Memo: nullText(r.TransactionMemo),
			Payee: nullText(r.TransactionPayee), ByAI: r.ByAi != 0,
			SourceID: nullID(r.SourceID), SourceName: nullText(r.SourceName),
		})
	}
	return out, nil
}

// Message returns one mail of the mailbox's history with its text.
func (s *Service) Message(ctx context.Context, walletID, mailboxID, id int64) (MailDetail, error) {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return MailDetail{}, err
	}
	m, err := s.rq.GetMailMessageView(ctx, db.GetMailMessageViewParams{ID: id, MailboxID: mailboxID})
	if errors.Is(err, sql.ErrNoRows) {
		return MailDetail{}, ErrNotFound
	}
	if err != nil {
		return MailDetail{}, err
	}
	return MailDetail{
		MailSummary: MailSummary{
			ID: m.ID, Sender: m.Sender, Subject: m.Subject, ReceivedAt: m.ReceivedAt,
			Outcome: m.Outcome, Detail: m.Detail, Authenticated: m.Authenticated != 0,
			PatternID: nullID(m.PatternID), TransactionID: nullID(m.TransactionID), AccountID: nullID(m.AccountID),
			Amount: nullID(m.TransactionAmount), Memo: nullText(m.TransactionMemo),
			Payee: nullText(m.TransactionPayee), ByAI: m.ByAi != 0,
			SourceID: nullID(m.SourceID), SourceName: nullText(m.SourceName),
		},
		Body: m.Body,
	}, nil
}

func nullText(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func nullID(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	return &v.Int64
}
