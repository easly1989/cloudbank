// Command e2e-mail is a pretend Microsoft for the bank-mail end-to-end tests
// (#657): the identity platform's device-code sign-in, and an Outlook IMAP
// server that takes only the access tokens it issued (SASL XOAUTH2), as the
// real one does. Beside it runs a pretend provider with app passwords (#658),
// a second IMAP server whose one mailbox logs in with a password, and a
// pretend AI provider (#659) with the OpenAI-compatible chat API, which reads
// a notice with two fixed sentences and remembers the last text it was sent
// (GET /ai/last), so a test can see what left CloudBank. It never leaves this
// machine and holds only invented mail.
//
// The tests deliver mail with POST /deliver, a JSON {mailbox, folder, from,
// subject, body, authenticated}, where mailbox "imap" is the app-password one;
// the sign-in page at /device approves a user code.
//
//	E2E_MAIL_HTTP=127.0.0.1:9100 E2E_MAIL_IMAP=127.0.0.1:1143 \
//	E2E_MAIL_PASSWORD_IMAP=127.0.0.1:1144 go run ./cmd/e2e-mail
//
// CloudBank reaches it with CB_MS_AUTHORITY=http://127.0.0.1:9100,
// CB_MS_IMAP=127.0.0.1:1143 and CB_MAIL_LOCAL_IMAP=127.0.0.1:1144; an
// administrator's AI settings point at http://127.0.0.1:9100/v1.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
	"github.com/emersion/go-sasl"
)

// address is the Outlook mailbox; guestAddress and guestPassword are the
// app-password one's. The password is a test value: it opens nothing but this
// pretend mailbox.
const (
	address       = "notifiche.demo@example.com"
	guestAddress  = "avvisi.demo@example.net"
	guestPassword = "e2e-app-password"
)

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func random() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// fake holds the sign-ins, the tokens and the mailbox.
type fake struct {
	httpAddr string
	user     *imapmemserver.User
	guest    *imapmemserver.User

	mu      sync.Mutex
	codes   map[string]*signIn // device code → sign-in
	aiLast  string             // the last text the pretend AI was sent
	access  map[string]bool
	refresh map[string]bool
	n       int
}

type signIn struct {
	userCode string
	approved bool
}

func main() {
	f := &fake{
		httpAddr: getenv("E2E_MAIL_HTTP", "127.0.0.1:9100"),
		codes:    map[string]*signIn{}, access: map[string]bool{}, refresh: map[string]bool{},
	}
	// Outlook takes no password over IMAP: this one is never told to anyone.
	f.user = imapmemserver.NewUser(address, random())
	for _, name := range []string{"INBOX", "Banca"} {
		if err := f.user.Create(name, nil); err != nil {
			log.Fatal(err)
		}
	}
	mem := imapmemserver.New()
	mem.AddUser(f.user)

	srv := imapserver.New(&imapserver.Options{
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return &session{UserSession: imapmemserver.NewUserSession(f.user), fake: f}, nil, nil
		},
		Caps: imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapIdle: {}},
		// Plain TCP on this machine only; CloudBank refuses plain IMAP elsewhere.
		InsecureAuth: true,
	})
	ln, err := net.Listen("tcp", getenv("E2E_MAIL_IMAP", "127.0.0.1:1143"))
	if err != nil {
		log.Fatal(err)
	}
	go func() { log.Fatal(srv.Serve(ln)) }()

	// The app-password provider: an ordinary LOGIN, which a wrong password
	// gets refused.
	f.guest = imapmemserver.NewUser(guestAddress, guestPassword)
	for _, name := range []string{"INBOX", "Banca"} {
		if err := f.guest.Create(name, nil); err != nil {
			log.Fatal(err)
		}
	}
	guests := imapmemserver.New()
	guests.AddUser(f.guest)
	psrv := imapserver.New(&imapserver.Options{
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return guests.NewSession(), nil, nil
		},
		Caps:         imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapIdle: {}},
		InsecureAuth: true,
	})
	pln, err := net.Listen("tcp", getenv("E2E_MAIL_PASSWORD_IMAP", "127.0.0.1:1144"))
	if err != nil {
		log.Fatal(err)
	}
	go func() { log.Fatal(psrv.Serve(pln)) }()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /devicecode", f.deviceCode)
	mux.HandleFunc("GET /device", f.devicePage)
	mux.HandleFunc("POST /device", f.approve)
	mux.HandleFunc("POST /token", f.token)
	mux.HandleFunc("POST /deliver", f.deliver)
	mux.HandleFunc("POST /v1/chat/completions", f.chat)
	mux.HandleFunc("GET /ai/last", f.aiLastText)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })
	log.Printf("pretend Microsoft on http://%s, IMAP on %s; app-password IMAP on %s", f.httpAddr, ln.Addr(), pln.Addr())
	hs := &http.Server{Addr: f.httpAddr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(hs.ListenAndServe())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func oauthError(w http.ResponseWriter, code string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": code, "error_description": "pretend Microsoft: " + code})
}

func (f *fake) deviceCode(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	f.n++
	device, user := random(), fmt.Sprintf("E2E%04d", f.n)
	f.codes[device] = &signIn{userCode: user}
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"device_code": device, "user_code": user,
		"verification_uri": "http://" + f.httpAddr + "/device",
		"expires_in":       900, "interval": 1,
	})
}

func (f *fake) devicePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	msg := ""
	if r.URL.Query().Get("done") != "" {
		msg = "<p role=\"status\">Signed in. You can close this page.</p>"
	}
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pretend Microsoft</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><h1>Pretend Microsoft</h1><p>A test sign-in for %s.</p>%s
<form method="post" action="/device"><label for="code">Code</label>
<input id="code" name="code" required autofocus>
<button type="submit">Allow</button></form></body></html>`, html.EscapeString(address), msg)
}

func (f *fake) approve(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.FormValue("code"))
	f.mu.Lock()
	found := false
	for _, s := range f.codes {
		if s.userCode == code {
			s.approved, found = true, true
		}
	}
	f.mu.Unlock()
	if !found {
		http.Error(w, "unknown code", http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, "/device?done=1", http.StatusSeeOther)
}

func (f *fake) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		oauthError(w, "invalid_request")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch r.PostForm.Get("grant_type") {
	case "urn:ietf:params:oauth:grant-type:device_code":
		s, ok := f.codes[r.PostForm.Get("device_code")]
		switch {
		case !ok:
			oauthError(w, "expired_token")
			return
		case !s.approved:
			oauthError(w, "authorization_pending")
			return
		}
		delete(f.codes, r.PostForm.Get("device_code"))
	case "refresh_token":
		if !f.refresh[r.PostForm.Get("refresh_token")] {
			oauthError(w, "invalid_grant")
			return
		}
		delete(f.refresh, r.PostForm.Get("refresh_token"))
	default:
		oauthError(w, "unsupported_grant_type")
		return
	}
	access, refresh := random(), random()
	f.access[access], f.refresh[refresh] = true, true
	claims, _ := json.Marshal(map[string]string{"preferred_username": address})
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access, "refresh_token": refresh, "expires_in": 3600, "token_type": "Bearer",
		"id_token": "e30." + base64.RawURLEncoding.EncodeToString(claims) + ".unsigned",
	})
}

// deliver puts one invented mail in a folder, as the bank's mail server
// would, with the receiving server's verdict on its sender on top.
func (f *fake) deliver(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mailbox       string `json:"mailbox"`
		Folder        string `json:"folder"`
		From          string `json:"from"`
		Subject       string `json:"subject"`
		Body          string `json:"body"`
		Authenticated bool   `json:"authenticated"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.From == "" {
		http.Error(w, "want {mailbox, folder, from, subject, body, authenticated}", http.StatusBadRequest)
		return
	}
	if in.Folder == "" {
		in.Folder = "INBOX"
	}
	user, to := f.user, address
	if in.Mailbox == "imap" {
		user, to = f.guest, guestAddress
	}
	domain := in.From[strings.LastIndexByte(in.From, '@')+1:]
	verdict := "fail"
	if in.Authenticated {
		verdict = "pass"
	}
	var raw bytes.Buffer
	fmt.Fprintf(&raw, "Authentication-Results: mx.example.com; dmarc=%s header.from=%s\r\n", verdict, domain)
	fmt.Fprintf(&raw, "From: %s\r\nTo: %s\r\nSubject: %s\r\n", in.From, to, in.Subject)
	fmt.Fprintf(&raw, "Message-ID: <%s@%s>\r\nDate: %s\r\n", random(), domain, time.Now().Format(time.RFC1123Z))
	raw.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n")
	raw.WriteString(strings.ReplaceAll(in.Body, "\n", "\r\n") + "\r\n")
	if _, err := user.Append(in.Folder, bytes.NewReader(raw.Bytes()), &imap.AppendOptions{}); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var (
	// The two sentences the pretend AI understands, as the e2e mails write
	// them: a card payment and a transfer received.
	rePaid     = regexp.MustCompile(`pagamento di ([\d.,]+) EUR .*?presso (.+?)[,.]`)
	reReceived = regexp.MustCompile(`ricevuto un bonifico di ([\d.,]+) EUR da (.+?)\.`)
)

// chat answers an OpenAI-compatible chat completion the way the bank-mail
// reader asks it to: a payment, or {"payment":false}.
func (f *fake) chat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || len(in.Messages) == 0 {
		http.Error(w, "want a chat completion", http.StatusBadRequest)
		return
	}
	text := in.Messages[len(in.Messages)-1].Content
	f.mu.Lock()
	f.aiLast = text
	f.mu.Unlock()
	answer := map[string]any{"payment": false}
	if m := rePaid.FindStringSubmatch(text); m != nil {
		answer = map[string]any{"payment": true, "amount": m[1], "direction": "out", "date": "", "text": m[2]}
	} else if m := reReceived.FindStringSubmatch(text); m != nil {
		answer = map[string]any{"payment": true, "amount": m[1], "direction": "in", "date": "", "text": m[2]}
	}
	content, _ := json.Marshal(answer)
	writeJSON(w, http.StatusOK, map[string]any{
		"choices": []map[string]any{{"message": map[string]string{"role": "assistant", "content": string(content)}}},
	})
}

func (f *fake) aiLastText(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(f.aiLast))
}

// session is the mailbox's IMAP session: XOAUTH2 with an issued access token
// is the only way in.
type session struct {
	*imapmemserver.UserSession
	fake *fake
}

func (s *session) Login(string, string) error { return imapserver.ErrAuthFailed }

func (s *session) AuthenticateMechanisms() []string { return []string{"XOAUTH2"} }

func (s *session) Authenticate(mech string) (sasl.Server, error) {
	if mech != "XOAUTH2" {
		return nil, imapserver.ErrAuthFailed
	}
	return xoauth2{s.fake}, nil
}

type xoauth2 struct{ fake *fake }

// Next reads "user=<address>\x01auth=Bearer <token>\x01\x01".
func (x xoauth2) Next(resp []byte) ([]byte, bool, error) {
	var user, token string
	for _, part := range strings.Split(string(resp), "\x01") {
		if v, ok := strings.CutPrefix(part, "user="); ok {
			user = v
		}
		if v, ok := strings.CutPrefix(part, "auth=Bearer "); ok {
			token = v
		}
	}
	x.fake.mu.Lock()
	ok := x.fake.access[token]
	x.fake.mu.Unlock()
	if !ok || !strings.EqualFold(user, address) {
		return nil, true, errors.New("pretend Microsoft: the token is not one it issued")
	}
	return nil, true, nil
}
