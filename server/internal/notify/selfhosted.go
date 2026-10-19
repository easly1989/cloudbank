package notify

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

// The self-hosted push services (#689): ntfy and Gotify. Both are often on
// the person's own network, so a server there needs an administrator, like
// the webhook. They are the person's own: no code to confirm, no hourly cap.

var (
	ntfyTopic = regexp.MustCompile(`^[-_A-Za-z0-9]{1,64}$`)
	// appToken is an ntfy access token or a Gotify application token: it goes
	// in a header, so nothing that could break one.
	appToken = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
)

// DefaultNtfyServer is the public ntfy server, used when the person names none.
const DefaultNtfyServer = "https://ntfy.sh"

type selfHostedSender struct {
	public, local *http.Client
	send          func(ctx context.Context, hc *http.Client, to Recipient, e Event) error
}

func newSelfHostedSender(send func(ctx context.Context, hc *http.Client, to Recipient, e Event) error) *selfHostedSender {
	return &selfHostedSender{
		public: &http.Client{Timeout: 15 * time.Second, Transport: netguard.Transport()},
		local:  &http.Client{Timeout: 15 * time.Second},
		send:   send,
	}
}

// Send delivers e, reaching the local network only for a channel an
// administrator saved.
func (s *selfHostedSender) Send(ctx context.Context, to Recipient, e Event) error {
	hc := s.public
	if to.LocalOK {
		hc = s.local
	}
	return s.send(ctx, hc, to, e)
}

// NewNtfySender publishes to the topic in to.Target on the server in
// to.Server, with the access token in to.Secret when there is one.
func NewNtfySender() Sender {
	return newSelfHostedSender(func(ctx context.Context, hc *http.Client, to Recipient, e Event) error {
		h := http.Header{}
		if to.Secret != "" {
			h.Set("Authorization", "Bearer "+to.Secret)
		}
		return postJSON(ctx, hc, strings.TrimRight(to.Server, "/")+"/",
			map[string]any{"topic": to.Target, "title": e.Title, "message": e.Body}, h)
	})
}

// NewGotifySender posts a message to the server in to.Server with the
// application token in to.Secret.
func NewGotifySender() Sender {
	return newSelfHostedSender(func(ctx context.Context, hc *http.Client, to Recipient, e Event) error {
		h := http.Header{}
		h.Set("X-Gotify-Key", to.Secret)
		return postJSON(ctx, hc, strings.TrimRight(to.Server, "/")+"/message",
			map[string]any{"title": e.Title, "message": e.Body, "priority": 5}, h)
	})
}
