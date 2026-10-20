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
// For the notification channels (#686) it is also an SMTP server that keeps
// what it is sent (E2E_MAIL_SMTP, no TLS, no login) and a webhook receiver at
// POST /hook/<name>, which answers 401 for the name "unauthorized"; both show
// what arrived at GET /notify/received. It is a Matrix homeserver too (#687),
// with two accounts: the shared bot (token matrixBotToken), which may join
// only a room it was invited to (POST /notify/matrix/invite, as a person would
// in their Matrix app; GET /sync lists the invitations) and post only once in,
// and a person's own (matrixUserToken); any other token gets a 401. It also
// takes the chat services (#688): the Telegram Bot API under /telegram (two
// bot tokens, telegramSharedToken and telegramUserToken; POST
// /notify/telegram/start queues a message to the shared bot, as a person
// pressing Start, for getUpdates), and Discord and Slack incoming webhooks at
// /discord/<name> and /slack/<name>, which refuse the name "unauthorized".
// It is an ntfy server at /ntfy (no token, or ntfyToken) and a Gotify server
// at /gotify (gotifyToken) too (#689); any other token gets a 401.
//
//	E2E_MAIL_HTTP=127.0.0.1:9100 E2E_MAIL_IMAP=127.0.0.1:1143 \
//	E2E_MAIL_PASSWORD_IMAP=127.0.0.1:1144 go run ./cmd/e2e-mail
//
// CloudBank reaches it with CB_MS_AUTHORITY=http://127.0.0.1:9100,
// CB_MS_IMAP=127.0.0.1:1143 and CB_MAIL_LOCAL_IMAP=127.0.0.1:1144; an
// administrator's AI settings point at http://127.0.0.1:9100/v1.
package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
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
	// The pretend homeserver's access tokens: test values, nothing else.
	matrixBotToken  = "e2e-matrix-bot"
	matrixUserToken = "e2e-matrix-user"
	// The pretend Bot API's tokens, shaped like Telegram's: test values.
	telegramSharedToken = "111111:e2e-telegram-shared-bot-token"
	telegramUserToken   = "222222:e2e-telegram-user-bot-token0"
	// The pretend ntfy and Gotify servers' tokens: test values.
	ntfyToken   = "tk_e2e-ntfy-token"
	gotifyToken = "e2e-gotify-app"
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
	mails   []received         // what the SMTP server was sent
	hooks   []received         // what the webhook receiver was sent
	matrix  []received         // what the homeserver was sent
	invited map[string]bool    // the rooms the shared Matrix bot was invited to
	joined  map[string]bool    // "user room" for each Matrix account in a room
	chats   []received         // what Telegram, Discord and Slack were sent
	updates []map[string]any   // what was sent to the shared Telegram bot
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
		joined: map[string]bool{}, invited: map[string]bool{},
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
	mux.HandleFunc("POST /hook/{name}", f.hook)
	mux.HandleFunc("GET /notify/received", f.received)
	mux.HandleFunc("GET /_matrix/client/v3/account/whoami", f.matrixWhoami)
	mux.HandleFunc("POST /_matrix/client/v3/join/{room}", f.matrixJoin)
	mux.HandleFunc("GET /_matrix/client/v3/sync", f.matrixSync)
	mux.HandleFunc("POST /notify/matrix/invite", f.matrixInvite)
	mux.HandleFunc("PUT /_matrix/client/v3/rooms/{room}/send/m.room.message/{txn}", f.matrixSend)
	mux.HandleFunc("GET /telegram/{bot}/getMe", f.telegramGetMe)
	mux.HandleFunc("POST /telegram/{bot}/sendMessage", f.telegramSend)
	mux.HandleFunc("GET /telegram/{bot}/getUpdates", f.telegramUpdates)
	mux.HandleFunc("POST /notify/telegram/start", f.telegramStart)
	mux.HandleFunc("POST /discord/{name}", f.chatHook)
	mux.HandleFunc("POST /slack/{name}", f.chatHook)
	mux.HandleFunc("POST /ntfy/", f.ntfy)
	mux.HandleFunc("POST /gotify/message", f.gotify)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })
	sln, err := net.Listen("tcp", getenv("E2E_MAIL_SMTP", "127.0.0.1:1025"))
	if err != nil {
		log.Fatal(err)
	}
	go f.serveSMTP(sln)
	log.Printf("pretend Microsoft on http://%s, IMAP on %s; app-password IMAP on %s; SMTP on %s",
		f.httpAddr, ln.Addr(), pln.Addr(), sln.Addr())
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
	// A budget proposal (#698) is two or three sentences.
	if strings.Contains(text, "Budget proposals") {
		writeJSON(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{
				"role": "assistant", "content": "Your rent comes back every month without a budget.",
			}}},
		})
		return
	}
	// So is a subscription proposal (#699).
	if strings.Contains(text, "Subscription proposals") {
		writeJSON(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{
				"role": "assistant", "content": "Your streaming now costs more than the schedule says.",
			}}},
		})
		return
	}
	// A monthly report (#696) is plain paragraphs, not JSON.
	if strings.Contains(text, "Write the report in") {
		writeJSON(w, http.StatusOK, map[string]any{
			"choices": []map[string]any{{"message": map[string]string{
				"role":    "assistant",
				"content": "A quiet month: you kept 1250.00 EUR aside.\n\nGroceries were the largest category.",
			}}},
		})
		return
	}
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

// received is one message the SMTP server or the webhook receiver took.
type received struct {
	To        string          `json:"to,omitempty"`
	Subject   string          `json:"subject,omitempty"`
	Body      string          `json:"body,omitempty"`
	Hook      string          `json:"hook,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	Signature string          `json:"signature,omitempty"`
	Room      string          `json:"room,omitempty"`
	Sender    string          `json:"sender,omitempty"`
}

func (f *fake) hook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil || !json.Valid(body) {
		http.Error(w, "want JSON", http.StatusBadRequest)
		return
	}
	name := r.PathValue("name")
	if name == "unauthorized" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	f.hooks = append(f.hooks, received{Hook: name, Payload: body, Signature: r.Header.Get("X-CloudBank-Signature")})
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (f *fake) received(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"mails": append([]received{}, f.mails...), "hooks": append([]received{}, f.hooks...),
		"matrix": append([]received{}, f.matrix...), "chats": append([]received{}, f.chats...),
	})
}

// telegramBot names the bot behind the path's "bot<token>", "" for none.
func telegramBot(r *http.Request) string {
	switch strings.TrimPrefix(r.PathValue("bot"), "bot") {
	case telegramSharedToken:
		return "shared"
	case telegramUserToken:
		return "own"
	}
	return ""
}

func telegramError(w http.ResponseWriter, status int, what string) {
	writeJSON(w, status, map[string]any{"ok": false, "error_code": status, "description": what})
}

func (f *fake) telegramGetMe(w http.ResponseWriter, r *http.Request) {
	if telegramBot(r) == "" {
		telegramError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": map[string]any{"is_bot": true, "username": "cloudbank_demo_bot"}})
}

// telegramSend takes a message for any chat but "0", which no bot knows.
func (f *fake) telegramSend(w http.ResponseWriter, r *http.Request) {
	bot := telegramBot(r)
	if bot == "" {
		telegramError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	var msg struct {
		ChatID string `json:"chat_id"`
		Text   string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&msg); err != nil || msg.Text == "" {
		telegramError(w, http.StatusBadRequest, "Bad Request: message text is empty")
		return
	}
	if msg.ChatID == "0" {
		telegramError(w, http.StatusBadRequest, "Bad Request: chat not found")
		return
	}
	f.mu.Lock()
	f.chats = append(f.chats, received{Hook: "telegram", To: msg.ChatID, Sender: bot, Body: msg.Text})
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": map[string]any{"message_id": 1}})
}

// telegramStart queues a message to the shared bot, as a person sending it
// /start from a chat.
func (f *fake) telegramStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Chat int64  `json:"chat"`
		Text string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		http.Error(w, "want JSON", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.updates = append(f.updates, map[string]any{
		"update_id": len(f.updates) + 1,
		"message":   map[string]any{"text": in.Text, "chat": map[string]any{"id": in.Chat}},
	})
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// telegramUpdates hands the shared bot what was sent to it from offset on.
func (f *fake) telegramUpdates(w http.ResponseWriter, r *http.Request) {
	if telegramBot(r) != "shared" {
		telegramError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	var offset int
	_, _ = fmt.Sscan(r.URL.Query().Get("offset"), &offset)
	f.mu.Lock()
	defer f.mu.Unlock()
	from := min(max(offset-1, 0), len(f.updates))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": append([]map[string]any{}, f.updates[from:]...)})
}

// ntfy publishes to a topic: without a token, or with ntfyToken.
func (f *fake) ntfy(w http.ResponseWriter, r *http.Request) {
	if a := r.Header.Get("Authorization"); a != "" && a != "Bearer "+ntfyToken {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 40101, "error": "unauthorized"})
		return
	}
	var msg struct {
		Topic   string `json:"topic"`
		Title   string `json:"title"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&msg); err != nil || msg.Topic == "" {
		http.Error(w, "want a topic", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.chats = append(f.chats, received{Hook: "ntfy/" + msg.Topic, Body: msg.Title + "\n" + msg.Message})
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": random(), "topic": msg.Topic})
}

// gotify takes a message with the application token gotifyToken.
func (f *fake) gotify(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Gotify-Key") != gotifyToken {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Unauthorized", "errorCode": 401})
		return
	}
	var msg struct {
		Title   string `json:"title"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&msg); err != nil || msg.Message == "" {
		http.Error(w, "want a message", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.chats = append(f.chats, received{Hook: "gotify", Body: msg.Title + "\n" + msg.Message})
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": 1})
}

// chatHook is a Discord or Slack incoming webhook: Discord answers 204 and
// refuses with 401, Slack answers "ok" and refuses with 403.
func (f *fake) chatHook(w http.ResponseWriter, r *http.Request) {
	slack := strings.HasPrefix(r.URL.Path, "/slack/")
	var msg struct {
		Content string `json:"content"`
		Text    string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&msg); err != nil {
		http.Error(w, "want JSON", http.StatusBadRequest)
		return
	}
	switch {
	case r.PathValue("name") == "unauthorized" && slack:
		http.Error(w, "invalid_token", http.StatusForbidden)
		return
	case r.PathValue("name") == "unauthorized":
		http.Error(w, `{"message": "Invalid Webhook Token", "code": 50027}`, http.StatusUnauthorized)
		return
	}
	service, body := "discord", msg.Content
	if slack {
		service, body = "slack", msg.Text
	}
	f.mu.Lock()
	f.chats = append(f.chats, received{Hook: service + "/" + r.PathValue("name"), Body: body})
	f.mu.Unlock()
	if slack {
		_, _ = w.Write([]byte("ok"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// matrixUser is the account behind the request's token, "" for none.
func matrixUser(r *http.Request) string {
	switch strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") {
	case matrixBotToken:
		return "@cloudbank:matrix.example"
	case matrixUserToken:
		return "@demo-bot:matrix.example"
	}
	return ""
}

func matrixError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"errcode": code, "error": "pretend homeserver: " + code})
}

func (f *fake) matrixWhoami(w http.ResponseWriter, r *http.Request) {
	user := matrixUser(r)
	if user == "" {
		matrixError(w, http.StatusUnauthorized, "M_UNKNOWN_TOKEN")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"user_id": user})
}

// matrixInvite invites the shared bot to a room, as a person would in their
// Matrix app.
func (f *fake) matrixInvite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Room string `json:"room"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Room == "" {
		http.Error(w, "want a room", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.invited[in.Room] = true
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// matrixSync lists the rooms an account is in and the ones it is invited to;
// nothing else of a real sync.
func (f *fake) matrixSync(w http.ResponseWriter, r *http.Request) {
	user := matrixUser(r)
	if user == "" {
		matrixError(w, http.StatusUnauthorized, "M_UNKNOWN_TOKEN")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	join, invite := map[string]any{}, map[string]any{}
	for k := range f.joined {
		if room, ok := strings.CutPrefix(k, user+" "); ok {
			join[room] = map[string]any{}
		}
	}
	if user == "@cloudbank:matrix.example" {
		for room := range f.invited {
			if !f.joined[user+" "+room] {
				invite[room] = map[string]any{}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"next_batch": "s1", "rooms": map[string]any{"join": join, "invite": invite}})
}

// matrixJoin lets an account into a room; the shared bot needs an invitation.
func (f *fake) matrixJoin(w http.ResponseWriter, r *http.Request) {
	user := matrixUser(r)
	if user == "" {
		matrixError(w, http.StatusUnauthorized, "M_UNKNOWN_TOKEN")
		return
	}
	room := r.PathValue("room")
	f.mu.Lock()
	defer f.mu.Unlock()
	if user == "@cloudbank:matrix.example" && !f.invited[room] {
		matrixError(w, http.StatusForbidden, "M_FORBIDDEN")
		return
	}
	f.joined[user+" "+room] = true
	writeJSON(w, http.StatusOK, map[string]string{"room_id": room})
}

// matrixSend takes a message from an account in the room: the shared bot is
// only invited until it joins.
func (f *fake) matrixSend(w http.ResponseWriter, r *http.Request) {
	user := matrixUser(r)
	if user == "" {
		matrixError(w, http.StatusUnauthorized, "M_UNKNOWN_TOKEN")
		return
	}
	var msg struct {
		Msgtype string `json:"msgtype"`
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&msg); err != nil || msg.Msgtype == "" {
		matrixError(w, http.StatusBadRequest, "M_BAD_JSON")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if user == "@cloudbank:matrix.example" && !f.joined[user+" "+r.PathValue("room")] {
		matrixError(w, http.StatusForbidden, "M_FORBIDDEN")
		return
	}
	f.matrix = append(f.matrix, received{Room: r.PathValue("room"), Sender: user, Body: msg.Body})
	writeJSON(w, http.StatusOK, map[string]string{"event_id": "$" + random()})
}

// serveSMTP is just enough of an SMTP server for one client on this machine:
// no TLS, no login, one message per DATA.
func (f *fake) serveSMTP(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			log.Fatal(err)
		}
		go f.smtpSession(c)
	}
}

func (f *fake) smtpSession(c net.Conn) {
	defer func() { _ = c.Close() }()
	_ = c.SetDeadline(time.Now().Add(time.Minute))
	rd := bufio.NewReader(c)
	say := func(line string) { _, _ = c.Write([]byte(line + "\r\n")) }
	say("220 pretend.smtp ESMTP")
	var to string
	for {
		line, err := rd.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(cmd, "EHLO"):
			say("250-pretend.smtp")
			say("250 8BITMIME")
		case strings.HasPrefix(cmd, "HELO"):
			say("250 pretend.smtp")
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			say("250 OK")
		case strings.HasPrefix(cmd, "RCPT TO:"):
			to = strings.Trim(strings.TrimSpace(line)[len("RCPT TO:"):], " <>")
			say("250 OK")
		case cmd == "DATA":
			say("354 go ahead")
			var data strings.Builder
			for {
				l, err := rd.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				data.WriteString(strings.TrimPrefix(l, "."))
			}
			f.keepMail(to, data.String())
			say("250 OK")
		case cmd == "QUIT":
			say("221 bye")
			return
		case cmd == "RSET" || cmd == "NOOP":
			say("250 OK")
		default:
			say("502 not here")
		}
	}
}

// keepMail stores a message's recipient, subject and text body.
func (f *fake) keepMail(to, data string) {
	head, body, _ := strings.Cut(data, "\r\n\r\n")
	subject := ""
	for _, h := range strings.Split(head, "\r\n") {
		if v, ok := strings.CutPrefix(h, "Subject: "); ok {
			subject = v
		}
	}
	f.mu.Lock()
	f.mails = append(f.mails, received{To: to, Subject: subject, Body: strings.TrimSpace(body)})
	f.mu.Unlock()
}
