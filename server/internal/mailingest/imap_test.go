package mailingest

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"testing"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
)

const testUser, testPass = "notifiche.demo@example.com", "app-password"

// startIMAP runs an in-memory IMAP server with an INBOX and a "Banca" folder.
// Once logged in it always announces IDLE.
func startIMAP(t *testing.T) (Endpoint, *imapmemserver.User) {
	t.Helper()
	mem := imapmemserver.New()
	u := imapmemserver.NewUser(testUser, testPass)
	for _, name := range []string{"INBOX", "Banca"} {
		if err := u.Create(name, nil); err != nil {
			t.Fatal(err)
		}
	}
	mem.AddUser(u)
	srv := imapserver.New(&imapserver.Options{
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return mem.NewSession(), nil, nil
		},
		Caps:         imap.CapSet{imap.CapIMAP4rev1: {}},
		InsecureAuth: true,
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return Endpoint{Addr: ln.Addr().String()}, u
}

func appendMail(t *testing.T, u *imapmemserver.User, folder string, n int) {
	t.Helper()
	raw := fmt.Sprintf("From: Banca Demo <avvisi@banca.example>\r\n"+
		"To: %s\r\nSubject: Pagamento %d\r\nMessage-ID: <msg-%d@banca.example>\r\n"+
		"Date: Thu, 15 Oct 2026 17:56:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"+
		"Pagamento di %d,43 EUR presso Supermercato Demo\r\n", testUser, n, n, n)
	if _, err := u.Append(folder, bytes.NewReader([]byte(raw)), &imap.AppendOptions{}); err != nil {
		t.Fatal(err)
	}
}

func login(t *testing.T, ep Endpoint) *Session {
	t.Helper()
	s, err := Connect(context.Background(), ep, Credentials{Username: testUser, Password: testPass})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func TestFoldersListsSelectable(t *testing.T) {
	ep, _ := startIMAP(t)
	got, err := login(t, ep).Folders()
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(got) != "[INBOX Banca]" {
		t.Fatalf("folders = %v", got)
	}
}

func TestSinceReadsOnlyWhatArrivesAfterTheCursor(t *testing.T) {
	ep, u := startIMAP(t)
	appendMail(t, u, "Banca", 1) // before activation: never read
	s := login(t, ep)

	cur, err := s.End("Banca")
	if err != nil {
		t.Fatal(err)
	}
	got, cur2, err := s.Since("Banca", cur, 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("right after End: %d mails, err %v", len(got), err)
	}
	if cur2 != cur {
		t.Fatalf("cursor moved with nothing new: %+v -> %+v", cur, cur2)
	}

	appendMail(t, u, "Banca", 2)
	appendMail(t, u, "Banca", 3)
	got, cur3, err := s.Since("Banca", cur2, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || cur3.LastUID != cur2.LastUID+2 {
		t.Fatalf("got %d mails, cursor %+v", len(got), cur3)
	}
	if !bytes.Contains(got[0].Raw, []byte("Pagamento 2")) || !bytes.Contains(got[1].Raw, []byte("Pagamento 3")) {
		t.Fatal("mails not in UID order")
	}

	// Asking again from the new cursor reads nothing: the last message is not
	// returned twice (a UID range "n:*" always matches the newest mail).
	got, _, err = s.Since("Banca", cur3, 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("again: %d mails, err %v", len(got), err)
	}
}

func TestSinceNeverMarksMailsRead(t *testing.T) {
	ep, u := startIMAP(t)
	s := login(t, ep)
	cur, _ := s.End("Banca")
	appendMail(t, u, "Banca", 1)
	if _, _, err := s.Since("Banca", cur, 50); err != nil {
		t.Fatal(err)
	}

	// Look with a separate plain client: no flag was set by reading.
	c, err := imapclient.DialInsecure(ep.Addr, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.Close() }()
	if err := c.Login(testUser, testPass).Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Select("Banca", &imap.SelectOptions{ReadOnly: true}).Wait(); err != nil {
		t.Fatal(err)
	}
	msgs, err := c.Fetch(imap.SeqSetNum(1), &imap.FetchOptions{Flags: true}).Collect()
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 || len(msgs[0].Flags) != 0 {
		t.Fatalf("flags after reading = %v", msgs[0].Flags)
	}
}

func TestSinceRestartsAtTheEndWhenUIDValidityChanges(t *testing.T) {
	ep, u := startIMAP(t)
	s := login(t, ep)
	cur, _ := s.End("Banca")
	appendMail(t, u, "Banca", 1)

	// The folder is deleted and made again: its UIDVALIDITY changes, and the
	// mails in it now are the past.
	if err := u.Delete("Banca"); err != nil {
		t.Fatal(err)
	}
	if err := u.Create("Banca", nil); err != nil {
		t.Fatal(err)
	}
	appendMail(t, u, "Banca", 2)

	got, cur2, err := s.Since("Banca", cur, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("read %d mails from before the restart", len(got))
	}
	if cur2.UIDValidity == cur.UIDValidity || cur2.LastUID != 1 {
		t.Fatalf("cursor = %+v, want the new folder's end", cur2)
	}
	appendMail(t, u, "Banca", 3)
	got, _, err = s.Since("Banca", cur2, 50)
	if err != nil || len(got) != 1 || !bytes.Contains(got[0].Raw, []byte("Pagamento 3")) {
		t.Fatalf("after restart: %d mails, err %v", len(got), err)
	}
}

func TestSinceKeepsOnlyTheNewestWhenTooManyArrive(t *testing.T) {
	ep, u := startIMAP(t)
	s := login(t, ep)
	cur, _ := s.End("Banca")
	for i := 1; i <= 5; i++ {
		appendMail(t, u, "Banca", i)
	}
	got, cur2, err := s.Since("Banca", cur, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || !bytes.Contains(got[1].Raw, []byte("Pagamento 5")) || cur2.LastUID != 5 {
		t.Fatalf("got %d, cursor %+v", len(got), cur2)
	}
}

func TestConnectRejectsWrongPassword(t *testing.T) {
	ep, _ := startIMAP(t)
	_, err := Connect(context.Background(), ep, Credentials{Username: testUser, Password: "wrong"})
	if err == nil {
		t.Fatal("a wrong password must fail")
	}
}

func TestXOAuth2InitialResponse(t *testing.T) {
	mech, ir, err := (&xoauth2{user: "a@example.com", token: "tok"}).Start()
	if err != nil || mech != "XOAUTH2" {
		t.Fatalf("mech %q err %v", mech, err)
	}
	if string(ir) != "user=a@example.com\x01auth=Bearer tok\x01\x01" {
		t.Fatalf("initial response = %q", ir)
	}
	// On failure the server sends a JSON challenge; the client answers empty.
	resp, err := (&xoauth2{}).Next([]byte(`{"status":"400"}`))
	if err != nil || len(resp) != 0 {
		t.Fatalf("next = %q, %v", resp, err)
	}
}
