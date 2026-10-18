package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

// WebhookPayload is the JSON a webhook receives (documented in
// docs/notifications.md; Home Assistant reads it as trigger.json).
type WebhookPayload struct {
	Event    Kind   `json:"event"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Path     string `json:"path"`
	WalletID int64  `json:"walletId,omitempty"`
	SentAt   string `json:"sentAt"`
	Test     bool   `json:"test"`
}

// SignatureHeader carries the HMAC-SHA256 of the body, keyed with the
// webhook's secret, as "sha256=<hex>", when the person set a secret.
const SignatureHeader = "X-CloudBank-Signature"

// WebhookSender posts the event to the person's URL.
type WebhookSender struct {
	// public and local are the clients for a URL that must be on the public
	// internet, and for one an administrator saved.
	public, local *http.Client
}

// NewWebhookSender returns a sender whose requests reach only the public
// internet unless the channel was saved by an administrator (#543).
func NewWebhookSender() *WebhookSender {
	return &WebhookSender{
		public: &http.Client{Timeout: 15 * time.Second, Transport: netguard.Transport()},
		local:  &http.Client{Timeout: 15 * time.Second},
	}
}

// Send posts e. Only the status of the answer is looked at: the URL is the
// person's, so its body is never read back (#543).
func (w *WebhookSender) Send(ctx context.Context, to Recipient, e Event) error {
	body, err := json.Marshal(WebhookPayload{
		Event: e.Kind, Title: e.Title, Body: e.Body, Path: e.URL, WalletID: e.WalletID,
		SentAt: time.Now().UTC().Format(time.RFC3339), Test: e.Test,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, to.Target, bytes.NewReader(body))
	if err != nil {
		return &DeliveryError{Reason: ReasonRejected}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CloudBank")
	if to.Secret != "" {
		mac := hmac.New(sha256.New, []byte(to.Secret))
		mac.Write(body)
		req.Header.Set(SignatureHeader, "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	hc := w.public
	if to.LocalOK {
		hc = w.local
	}
	resp, err := hc.Do(req)
	if err != nil {
		// The error names the URL: keep only its cause.
		return asDeliveryError(err)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return httpStatusError(resp.StatusCode)
	}
	return nil
}
