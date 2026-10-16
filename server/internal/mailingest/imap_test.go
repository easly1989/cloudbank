package mailingest

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"math/big"
	"net"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

const testUser, testPass = "notifiche.demo@example.com", "app-password"

// startIMAP runs an in-memory IMAP server with an INBOX and a "Banca" folder.
// Once logged in it always announces IDLE.
func startIMAP(t *testing.T) (Endpoint, *imapmemserver.User) {
	t.Helper()
	return startIMAPServer(t, nil, false)
}

// startIMAPServer is startIMAP with encryption: with cert, the server offers
// STARTTLS, or speaks TLS from the first byte when implicit. The endpoint
// returned trusts cert, and still needs TLS or StartTLS set to use it.
func startIMAPServer(t *testing.T, cert *tls.Certificate, implicit bool) (Endpoint, *imapmemserver.User) {
	t.Helper()
	mem := imapmemserver.New()
	u := imapmemserver.NewUser(testUser, testPass)
	for _, name := range []string{"INBOX", "Banca"} {
		if err := u.Create(name, nil); err != nil {
			t.Fatal(err)
		}
	}
	mem.AddUser(u)
	opts := &imapserver.Options{
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return mem.NewSession(), nil, nil
		},
		Caps:         imap.CapSet{imap.CapIMAP4rev1: {}},
		InsecureAuth: cert == nil || implicit,
	}
	var cfg *tls.Config
	if cert != nil {
		cfg = &tls.Config{Certificates: []tls.Certificate{*cert}}
		if !implicit {
			opts.TLSConfig = cfg
		}
	}
	srv := imapserver.New(opts)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if implicit {
		ln = tls.NewListener(ln, cfg)
	}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	ep := Endpoint{Addr: ln.Addr().String()}
	if cert != nil {
		roots := x509.NewCertPool()
		roots.AddCert(cert.Leaf)
		ep.ServerName, ep.roots = "127.0.0.1", roots
	}
	return ep, u
}

// selfSigned is a certificate for 127.0.0.1, made for one test.
func selfSigned(t *testing.T) *tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "imap.test"},
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return &tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}
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

// A wrong password is refused with the mail server's own words, which the
// connect form shows.
func TestConnectRejectsWrongPassword(t *testing.T) {
	ep, _ := startIMAP(t)
	_, err := Connect(context.Background(), ep, Credentials{Username: testUser, Password: "wrong"})
	var le *LoginError
	if !errors.Is(err, ErrLogin) || !errors.As(err, &le) || le.Text == "" {
		t.Fatalf("err = %v, want a LoginError with the server's text", err)
	}
}

func TestConnectOverSTARTTLS(t *testing.T) {
	ep, _ := startIMAPServer(t, selfSigned(t), false)
	ep.StartTLS = true
	got, err := login(t, ep).Folders()
	if err != nil || fmt.Sprint(got) != "[INBOX Banca]" {
		t.Fatalf("folders = %v, %v", got, err)
	}
}

func TestConnectOverImplicitTLS(t *testing.T) {
	ep, _ := startIMAPServer(t, selfSigned(t), true)
	ep.TLS = true
	if _, err := login(t, ep).Folders(); err != nil {
		t.Fatal(err)
	}
}

// STARTTLS is not optional: a server that does not offer it gets no password.
func TestSTARTTLSIsRequired(t *testing.T) {
	ep, _ := startIMAP(t)
	ep.StartTLS, ep.ServerName = true, "127.0.0.1"
	_, err := Connect(context.Background(), ep, Credentials{Username: testUser, Password: testPass})
	if !errors.Is(err, ErrTLS) {
		t.Fatalf("err = %v, want ErrTLS", err)
	}
}

// A certificate that is not trusted for the host ends the connection before
// the login.
func TestTLSChecksTheCertificate(t *testing.T) {
	ep, _ := startIMAPServer(t, selfSigned(t), true)
	ep.TLS, ep.roots = true, nil
	_, err := Connect(context.Background(), ep, Credentials{Username: testUser, Password: testPass})
	if !errors.Is(err, ErrTLS) {
		t.Fatalf("err = %v, want ErrTLS", err)
	}
}

// An endpoint a user named dials public addresses only.
func TestPublicEndpointRefusesThisMachine(t *testing.T) {
	ep, _ := startIMAP(t)
	ep.Public = true
	_, err := Connect(context.Background(), ep, Credentials{Username: testUser, Password: testPass})
	if !errors.Is(err, netguard.ErrNotPublic) || !errors.Is(err, ErrUnreachable) {
		t.Fatalf("err = %v, want ErrNotPublic", err)
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

func TestEndpointForUsesTLSAwayFromThisMachine(t *testing.T) {
	for addr, want := range map[string]Endpoint{
		"outlook.office365.com:993": {Addr: "outlook.office365.com:993", TLS: true, ServerName: "outlook.office365.com"},
		"localhost:1143":            {Addr: "localhost:1143"},
		"127.0.0.1:1143":            {Addr: "127.0.0.1:1143"},
		"[::1]:1143":                {Addr: "[::1]:1143"},
		"10.0.0.5:143":              {Addr: "10.0.0.5:143", TLS: true, ServerName: "10.0.0.5"},
	} {
		got, err := EndpointFor(addr)
		if err != nil || got != want {
			t.Errorf("%s: %+v, %v", addr, got, err)
		}
	}
	for _, bad := range []string{"", "localhost", ":993"} {
		if _, err := EndpointFor(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
