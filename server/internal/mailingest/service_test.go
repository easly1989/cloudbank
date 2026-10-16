package mailingest

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

type fixture struct {
	svc    *Service
	q      *db.Queries
	wallet int64
	other  int64
	uid    int64
	uid2   int64
	user   *imapmemserver.User
	clock  *time.Time
}

// withKey turns on at-rest encryption for one test, as CB_SECRET_KEY would.
func withKey(t *testing.T) {
	t.Helper()
	c, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(c)
	t.Cleanup(func() { secrets.Configure(nil) })
}

// newFixture wires the service to a fake Microsoft and an in-memory IMAP
// server whose password is the fake access token: the service logs in with
// the token, and the test server checks it as a password.
func newFixture(t *testing.T, tokenReplies ...func(http.ResponseWriter, *http.Request)) *fixture {
	t.Helper()
	return newFixtureWith(t, fixtureOpts{}, tokenReplies...)
}

// fixtureOpts vary the mail server: whether it is treated as one without IDLE
// (the test server always announces it), and an endpoint to reach it through
// (a proxy that can cut connections).
type fixtureOpts struct {
	noIdle bool
	route  func(Endpoint) Endpoint
}

func newFixtureWith(t *testing.T, o fixtureOpts, tokenReplies ...func(http.ResponseWriter, *http.Request)) *fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	w2, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	u1, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "demo", PasswordHash: "x", Locale: "it", Theme: "auto"})
	u2, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "other", PasswordHash: "x", Locale: "it", Theme: "auto"})

	if len(tokenReplies) == 0 {
		tokenReplies = []func(http.ResponseWriter, *http.Request){oauthError("authorization_pending"), tokenOK("refresh-1")}
	}
	ms, _ := fakeMicrosoft(t, tokenReplies...)

	ep, u := startIMAP(t)
	if o.route != nil {
		ep = o.route(ep)
	}
	// The fake token endpoint always issues "access-1".
	if err := u.Login(testUser, testPass); err != nil {
		t.Fatal(err)
	}
	svc := NewService(st.Read(), st.Write(), ms)
	svc.outlook = ep
	svc.tokenAuth = func(user, token string) Credentials {
		if token == "access-1" {
			return Credentials{Username: user, Password: testPass}
		}
		return Credentials{Username: user, Password: "wrong"}
	}
	if o.noIdle {
		svc.canIdle = func(*Session) bool { return false }
	}
	clock := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }
	return &fixture{svc: svc, q: q, wallet: w.ID, other: w2.ID, uid: u1.ID, uid2: u2.ID, user: u, clock: &clock}
}

func (f *fixture) tick(d time.Duration) { *f.clock = f.clock.Add(d) }

// connect runs a whole sign-in and returns the new mailbox.
func (f *fixture) connect(t *testing.T) Mailbox {
	t.Helper()
	ctx := context.Background()
	fl, err := f.svc.StartMicrosoft(ctx, f.wallet, f.uid, 0)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		f.tick(time.Duration(fl.Interval) * time.Second)
		st, err := f.svc.PollMicrosoft(ctx, f.wallet, f.uid, fl.FlowID)
		if err != nil {
			t.Fatal(err)
		}
		if st.State == "done" {
			return *st.Mailbox
		}
		if st.State != "pending" {
			t.Fatalf("state %q", st.State)
		}
	}
	t.Fatal("never done")
	return Mailbox{}
}

func TestUnavailableWithoutSecretKey(t *testing.T) {
	f := newFixture(t)
	if f.svc.Available() {
		t.Fatal("available without CB_SECRET_KEY")
	}
	if _, err := f.svc.StartMicrosoft(context.Background(), f.wallet, f.uid, 0); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestConnectReadsOnlyMailsAfterTheConnection(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	appendMail(t, f.user, "INBOX", 1) // already there: the past

	mb := f.connect(t)
	if mb.Address != testUser || mb.Folder != "INBOX" || mb.Status != StatusOK {
		t.Fatalf("mailbox = %+v", mb)
	}
	row, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: mb.ID, WalletID: f.wallet})
	if !strings.HasPrefix(row.Secret, "enc.v1:") || strings.Contains(row.Secret, "refresh-1") {
		t.Fatalf("the refresh token is not sealed: %q", row.Secret)
	}

	res, err := f.svc.Check(ctx, f.wallet, mb.ID)
	if err != nil || res.New != 0 {
		t.Fatalf("first check: %+v, %v", res, err)
	}
	appendMail(t, f.user, "INBOX", 2)
	res, err = f.svc.Check(ctx, f.wallet, mb.ID)
	if err != nil || res.New != 1 {
		t.Fatalf("second check: %+v, %v", res, err)
	}
	msgs, err := f.svc.Messages(ctx, f.wallet, mb.ID)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("messages: %+v, %v", msgs, err)
	}
	if msgs[0].Subject != "Pagamento 2" || msgs[0].Outcome != "unrecognized" || msgs[0].Sender != "avvisi@banca.example" {
		t.Fatalf("message = %+v", msgs[0])
	}
	if msgs[0].ReceivedAt != "2026-10-15T17:56:00+02:00" {
		t.Fatalf("received at = %q", msgs[0].ReceivedAt)
	}
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.New != 0 {
		t.Fatalf("a mail was read twice")
	}
	list, _ := f.svc.ListMailboxes(ctx, f.wallet)
	if len(list) != 1 || list[0].LastCheckAt == nil || list[0].LastMailAt == nil {
		t.Fatalf("list = %+v", list)
	}
}

func TestPollIsPacedByTheInterval(t *testing.T) {
	withKey(t)
	var calls int
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		oauthError("authorization_pending")(w, r)
	})
	ctx := context.Background()
	fl, err := f.svc.StartMicrosoft(ctx, f.wallet, f.uid, 0)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := f.svc.PollMicrosoft(ctx, f.wallet, f.uid, fl.FlowID); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 0 {
		t.Fatalf("asked Microsoft %d times before the interval", calls)
	}
	f.tick(5 * time.Second)
	_, _ = f.svc.PollMicrosoft(ctx, f.wallet, f.uid, fl.FlowID)
	if calls != 1 {
		t.Fatalf("calls = %d", calls)
	}
	f.tick(15 * time.Minute)
	st, _ := f.svc.PollMicrosoft(ctx, f.wallet, f.uid, fl.FlowID)
	if st.State != "expired" {
		t.Fatalf("after the code's lifetime: %q", st.State)
	}
}

func TestFlowsAndMailboxesStayInTheirWallet(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	fl, _ := f.svc.StartMicrosoft(ctx, f.wallet, f.uid, 0)
	if _, err := f.svc.PollMicrosoft(ctx, f.other, f.uid, fl.FlowID); !errors.Is(err, ErrFlowNotFound) {
		t.Fatalf("other wallet poll: %v", err)
	}
	if _, err := f.svc.PollMicrosoft(ctx, f.wallet, f.uid2, fl.FlowID); !errors.Is(err, ErrFlowNotFound) {
		t.Fatalf("other user poll: %v", err)
	}
	mb := f.connect(t)
	if _, err := f.svc.Check(ctx, f.other, mb.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other wallet check: %v", err)
	}
	if _, err := f.svc.Messages(ctx, f.other, mb.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other wallet messages: %v", err)
	}
	if err := f.svc.Remove(ctx, f.other, mb.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other wallet remove: %v", err)
	}
	if _, err := f.svc.StartMicrosoft(ctx, f.other, f.uid, mb.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other wallet reauth: %v", err)
	}
}

func TestRevokedSignInAsksForReauth(t *testing.T) {
	withKey(t)
	f := newFixture(t, oauthError("authorization_pending"), tokenOK("refresh-1"), oauthError("invalid_grant"))
	ctx := context.Background()
	mb := f.connect(t)
	f.tick(2 * time.Hour) // the cached access token has expired
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); !errors.Is(err, ErrReauth) {
		t.Fatalf("err = %v, want ErrReauth", err)
	}
	list, _ := f.svc.ListMailboxes(ctx, f.wallet)
	if list[0].Status != StatusReauth {
		t.Fatalf("status = %q", list[0].Status)
	}
}

func TestRefreshRotatesTheStoredToken(t *testing.T) {
	withKey(t)
	f := newFixture(t, oauthError("authorization_pending"), tokenOK("refresh-1"), tokenOK("refresh-2"))
	ctx := context.Background()
	mb := f.connect(t)
	f.tick(2 * time.Hour)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	row, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: mb.ID, WalletID: f.wallet})
	if got := secrets.Open(row.Secret); got != "refresh-2" {
		t.Fatalf("stored refresh token = %q", got)
	}
}

func TestChangingFolderStartsAtItsEnd(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	appendMail(t, f.user, "Banca", 1) // in the new folder before choosing it

	folders, err := f.svc.Folders(ctx, f.wallet, mb.ID)
	if err != nil || len(folders) != 2 {
		t.Fatalf("folders %v, %v", folders, err)
	}
	name := "Banca"
	if _, err := f.svc.Update(ctx, f.wallet, mb.ID, &name, nil); err != nil {
		t.Fatal(err)
	}
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.New != 0 {
		t.Fatal("read a mail from before the folder was chosen")
	}
	appendMail(t, f.user, "Banca", 2)
	appendMail(t, f.user, "INBOX", 3) // not the chosen folder
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.New != 1 {
		t.Fatal("did not read the new mail of the chosen folder")
	}
	missing := "Nope"
	if _, err := f.svc.Update(ctx, f.wallet, mb.ID, &missing, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing folder: %v", err)
	}
	paused := true
	got, err := f.svc.Update(ctx, f.wallet, mb.ID, nil, &paused)
	if err != nil || !got.Paused {
		t.Fatalf("pause: %+v %v", got, err)
	}
}

func TestHistoryKeepsTheNewest(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	f.svc.keep = 3
	ctx := context.Background()
	mb := f.connect(t)
	for i := 1; i <= 5; i++ {
		appendMail(t, f.user, "INBOX", i)
	}
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.New != 5 {
		t.Fatalf("new = %d", res.New)
	}
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	if len(msgs) != 3 || msgs[0].Subject != "Pagamento 5" || msgs[2].Subject != "Pagamento 3" {
		t.Fatalf("history = %+v", msgs)
	}
}

func TestSigningInTwiceKeepsOneMailbox(t *testing.T) {
	withKey(t)
	f := newFixture(t, oauthError("authorization_pending"), tokenOK("refresh-1"), oauthError("authorization_pending"), tokenOK("refresh-9"))
	ctx := context.Background()
	first := f.connect(t)
	second := f.connect(t)
	if first.ID != second.ID {
		t.Fatalf("a second sign-in made a second mailbox: %d, %d", first.ID, second.ID)
	}
	row, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: first.ID, WalletID: f.wallet})
	if got := secrets.Open(row.Secret); got != "refresh-9" {
		t.Fatalf("stored refresh token = %q", got)
	}
	if err := f.svc.Remove(ctx, f.wallet, first.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := f.svc.ListMailboxes(ctx, f.wallet); len(list) != 0 {
		t.Fatal("not removed")
	}
}
