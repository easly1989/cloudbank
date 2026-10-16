package mailingest

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/netguard"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// imapFixture is the fixture with its test server allowed as the one mail
// server on this machine, the way CB_MAIL_LOCAL_IMAP allows the end-to-end
// tests' pretend one. Any other address on this machine stays refused.
func imapFixture(t *testing.T) (*fixture, IMAPInput) {
	t.Helper()
	withKey(t)
	f := newFixture(t)
	addr := f.svc.outlook.Addr
	if err := f.svc.SetLocalIMAP(addr); err != nil {
		t.Fatal(err)
	}
	host, port, _ := net.SplitHostPort(addr)
	p, _ := strconv.Atoi(port)
	return f, IMAPInput{Address: "Notifiche.Demo@Example.com", Password: testPass, Host: host, Port: p, Security: SecurityTLS}
}

func TestIMAPMailboxConnectsAndReadsWhatArrivesAfter(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	appendMail(t, f.user, "INBOX", 1) // already there: the past

	mb, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in)
	if err != nil {
		t.Fatal(err)
	}
	if mb.Provider != ProviderIMAP || mb.Address != testUser || mb.Folder != "INBOX" || mb.Status != StatusOK {
		t.Fatalf("mailbox = %+v", mb)
	}
	if mb.IMAP == nil || *mb.IMAP != (IMAPSettings{Host: in.Host, Port: in.Port, Security: SecurityTLS, Username: testUser}) {
		t.Fatalf("imap settings = %+v", mb.IMAP)
	}
	row, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: mb.ID, WalletID: f.wallet})
	if !strings.HasPrefix(row.Secret, "enc.v1:") || strings.Contains(row.Secret, testPass) {
		t.Fatalf("the password is not sealed: %q", row.Secret)
	}

	res, err := f.svc.Check(ctx, f.wallet, mb.ID)
	if err != nil || res.New != 0 {
		t.Fatalf("first check: %+v, %v", res, err)
	}
	appendMail(t, f.user, "INBOX", 2)
	if res, err = f.svc.Check(ctx, f.wallet, mb.ID); err != nil || res.New != 1 {
		t.Fatalf("second check: %+v, %v", res, err)
	}
	folders, err := f.svc.Folders(ctx, f.wallet, mb.ID)
	if err != nil || len(folders) != 2 {
		t.Fatalf("folders = %v, %v", folders, err)
	}
}

// The password goes in and never comes out: not in the mailbox the connect
// answers with, nor in the list.
func TestIMAPPasswordNeverComesBack(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	mb, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in)
	if err != nil {
		t.Fatal(err)
	}
	list, err := f.svc.ListMailboxes(ctx, f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []any{mb, list} {
		raw, _ := json.Marshal(v)
		if strings.Contains(string(raw), testPass) || strings.Contains(string(raw), "enc.v1:") {
			t.Fatalf("the password leaks: %s", raw)
		}
	}
}

// A refused login saves nothing and says what the server said.
func TestIMAPWrongPasswordSavesNothing(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	in.Password = "wrong"
	_, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in)
	var le *LoginError
	if !errors.As(err, &le) || le.Text == "" {
		t.Fatalf("err = %v, want the server's refusal", err)
	}
	if list, _ := f.svc.ListMailboxes(ctx, f.wallet); len(list) != 0 {
		t.Fatalf("saved %d mailboxes", len(list))
	}
}

// A user cannot point the server at its own network: an address on this
// machine or the LAN, by number or by a name that resolves to one, is refused
// before any login.
func TestIMAPHostOffTheInternetIsRefused(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	for _, host := range []string{"localhost", "192.168.1.14", "10.0.0.1"} {
		in := in
		in.Host = host
		if _, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in); !errors.Is(err, netguard.ErrNotPublic) {
			t.Errorf("%s: err = %v, want ErrNotPublic", host, err)
		}
	}
	// The allowed test server on another port is another server.
	in.Port++
	if _, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in); !errors.Is(err, netguard.ErrNotPublic) {
		t.Errorf("another port: err = %v, want ErrNotPublic", err)
	}
	if list, _ := f.svc.ListMailboxes(ctx, f.wallet); len(list) != 0 {
		t.Fatalf("saved %d mailboxes", len(list))
	}
}

func TestIMAPInputIsChecked(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	for name, change := range map[string]func(*IMAPInput){
		"no encryption":  func(i *IMAPInput) { i.Security = "none" },
		"no port":        func(i *IMAPInput) { i.Port = 0 },
		"port too large": func(i *IMAPInput) { i.Port = 70000 },
		"no host":        func(i *IMAPInput) { i.Host = " " },
		"host with path": func(i *IMAPInput) { i.Host = "imap.example.com/x" },
		"no password":    func(i *IMAPInput) { i.Password = "" },
		"no address":     func(i *IMAPInput) { i.Address = "notifiche" },
	} {
		in := in
		change(&in)
		if _, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

func TestIMAPNeedsSecretKey(t *testing.T) {
	f := newFixture(t)
	_, err := f.svc.ConnectIMAP(context.Background(), f.wallet, f.uid, IMAPInput{
		Address: testUser, Password: testPass, Host: "imap.example.com", Port: 993, Security: SecurityTLS,
	})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

// A new app password for a mailbox keeps its folder, cursor and history; a
// wrong one changes nothing.
func TestIMAPNewPasswordKeepsTheMailbox(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	mb, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Update(ctx, f.wallet, mb.ID, ptr("Banca"), nil); err != nil {
		t.Fatal(err)
	}
	before, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: mb.ID, WalletID: f.wallet})

	again := IMAPInput{MailboxID: mb.ID, Password: "wrong", Host: in.Host, Port: in.Port, Security: SecurityStartTLS}
	if _, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, again); err == nil {
		t.Fatal("a wrong password was accepted")
	}
	if row, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: mb.ID, WalletID: f.wallet}); row.Secret != before.Secret || row.ImapSecurity != SecurityTLS {
		t.Fatal("a refused login changed the mailbox")
	}

	again.Password = testPass
	got, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, again)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := f.q.GetMailbox(ctx, db.GetMailboxParams{ID: mb.ID, WalletID: f.wallet})
	if got.ID != mb.ID || got.Folder != "Banca" || after.LastUid != before.LastUid || after.UidValidity != before.UidValidity {
		t.Fatalf("mailbox after = %+v", got)
	}
	if after.ImapSecurity != SecurityStartTLS || after.Secret == before.Secret {
		t.Fatal("the new settings were not saved")
	}
	if list, _ := f.svc.ListMailboxes(ctx, f.wallet); len(list) != 1 {
		t.Fatalf("%d mailboxes, want 1", len(list))
	}
}

// A new password is only for an IMAP mailbox of this wallet.
func TestIMAPNewPasswordOnlyForItsMailbox(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	ms := f.connect(t)
	in.MailboxID = ms.ID
	if _, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in); !errors.Is(err, ErrInvalid) {
		t.Fatalf("on a Microsoft mailbox: err = %v, want ErrInvalid", err)
	}
	in.MailboxID = 0
	mb, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in)
	if err != nil {
		t.Fatal(err)
	}
	in.MailboxID = mb.ID
	if _, err := f.svc.ConnectIMAP(ctx, f.other, f.uid, in); !errors.Is(err, ErrNotFound) {
		t.Fatalf("from another wallet: err = %v, want ErrNotFound", err)
	}
}

// Once the server refuses the stored password (revoked, changed), the mailbox
// waits for a new one instead of trying it again and again, which some
// providers punish by locking the account.
func TestIMAPRefusedPasswordStopsTheMailbox(t *testing.T) {
	f, in := imapFixture(t)
	ctx := context.Background()
	mb, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, in)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.SetMailboxSecret(ctx, db.SetMailboxSecretParams{Secret: f.svc.seal("revoked"), ID: mb.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); !errors.Is(err, ErrReauth) || !errors.Is(err, ErrLogin) {
		t.Fatalf("err = %v, want ErrReauth and ErrLogin", err)
	}
	list, _ := f.svc.ListMailboxes(ctx, f.wallet)
	if list[0].Status != StatusReauth || !strings.Contains(list[0].StatusDetail, "password") {
		t.Fatalf("mailbox = %+v", list[0])
	}
	watch, _ := f.q.ListMailboxesToWatch(ctx)
	if len(watch) != 0 {
		t.Fatal("the listener would keep trying the refused password")
	}
}

// Past the connect, an IMAP mailbox is listened to like a Microsoft one.
func TestListenerHearsAnIMAPMailbox(t *testing.T) {
	f, in := imapFixture(t)
	mb, err := f.svc.ConnectIMAP(context.Background(), f.wallet, f.uid, in)
	if err != nil {
		t.Fatal(err)
	}
	f.run(t)
	eventually(t, "the listener to idle", func() bool { return f.mode(t, mb.ID) == ModeIdle })
	appendMail(t, f.user, "INBOX", 1)
	eventually(t, "the mail to arrive", func() bool { return len(f.messages(t, mb.ID)) == 1 })
}

func TestSetLocalIMAPWantsThisMachine(t *testing.T) {
	f := newFixture(t)
	for _, bad := range []string{"imap.example.com:143", "10.0.0.5:143", "localhost", ""} {
		if err := f.svc.SetLocalIMAP(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func ptr[T any](v T) *T { return &v }
