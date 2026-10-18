package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

// MatrixBot is a Matrix account CloudBank posts as: the installation's shared
// bot, or a person's own.
type MatrixBot struct {
	// Homeserver is the client-server API root, such as https://matrix.org.
	Homeserver string
	// Token is the account's access token.
	Token string
}

// MatrixSender posts the event as a message in the person's room (#687).
type MatrixSender struct {
	// shared is the installation's bot, nil when the administrator set none.
	shared *MatrixBot
	// public and local are the clients for a homeserver that must be on the
	// public internet, and for one an administrator chose.
	public, local *http.Client

	mu sync.Mutex
	// botUser is the shared bot's Matrix ID, once the homeserver said it.
	botUser string
}

// NewMatrixSender returns a sender that posts as the person's own bot, or as
// shared when the person gave only a room. shared may be nil.
func NewMatrixSender(shared *MatrixBot) *MatrixSender {
	return &MatrixSender{
		shared: shared,
		public: &http.Client{Timeout: 15 * time.Second, Transport: netguard.Transport()},
		local:  &http.Client{Timeout: 15 * time.Second},
	}
}

// Shared reports whether the installation has a shared bot.
func (m *MatrixSender) Shared() bool { return m.shared != nil }

// BotUser is the shared bot's Matrix ID, such as @cloudbank:example.org, for
// people to invite to their room; empty without a shared bot, or while its
// homeserver does not answer.
func (m *MatrixSender) BotUser(ctx context.Context) string {
	if m.shared == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.botUser != "" {
		return m.botUser
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(m.shared.Homeserver, "/")+"/_matrix/client/v3/account/whoami", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+m.shared.Token)
	resp, err := m.local.Do(req)
	if err != nil {
		return ""
	}
	defer func() { _ = resp.Body.Close() }()
	var who struct {
		UserID string `json:"user_id"`
	}
	if resp.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&who) == nil {
		m.botUser = who.UserID
	}
	return m.botUser
}

// Send posts e in the room to.Target. A bot that was only invited is not in
// the room yet: on a 403 it accepts the invitation and tries once more.
func (m *MatrixSender) Send(ctx context.Context, to Recipient, e Event) error {
	bot, hc := MatrixBot{Homeserver: to.Server, Token: to.Secret}, m.public
	if to.LocalOK {
		hc = m.local
	}
	if to.Server == "" {
		if m.shared == nil {
			return &DeliveryError{Reason: ReasonRejected}
		}
		// The administrator set it, so it may be on the local network.
		bot, hc = *m.shared, m.local
	}
	room := url.PathEscape(to.Target)
	msg, err := json.Marshal(map[string]string{
		"msgtype":        "m.text",
		"body":           e.Title + "\n" + e.Body,
		"format":         "org.matrix.custom.html",
		"formatted_body": "<b>" + html.EscapeString(e.Title) + "</b><br>" + html.EscapeString(e.Body),
	})
	if err != nil {
		return err
	}
	txn := make([]byte, 16)
	_, _ = rand.Read(txn)
	send := "/_matrix/client/v3/rooms/" + room + "/send/m.room.message/" + hex.EncodeToString(txn)
	code, err := bot.call(ctx, hc, http.MethodPut, send, msg)
	if err == nil && code == http.StatusForbidden {
		if jc, jerr := bot.call(ctx, hc, http.MethodPost, "/_matrix/client/v3/join/"+room, []byte("{}")); jerr == nil && jc == http.StatusOK {
			code, err = bot.call(ctx, hc, http.MethodPut, send, msg)
		}
	}
	if err != nil {
		return asDeliveryError(err)
	}
	if code < 200 || code >= 300 {
		return httpStatusError(code)
	}
	return nil
}

// call sends one request and returns the status; the answer is not read,
// since an error's body would only repeat the room or the server back.
func (b MatrixBot) call(ctx context.Context, hc *http.Client, method, path string, body []byte) (int, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(b.Homeserver, "/")+path, bytes.NewReader(body))
	if err != nil {
		return 0, &DeliveryError{Reason: ReasonRejected}
	}
	req.Header.Set("Authorization", "Bearer "+b.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CloudBank")
	resp, err := hc.Do(req)
	if err != nil {
		return 0, err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	return resp.StatusCode, nil
}
