// Package push delivers Web Push notifications. It owns the server VAPID keypair
// (auto-generated on first run and persisted), stores per-browser subscriptions,
// and sends encrypted payloads via the Web Push protocol. The only trigger today
// is a daily "bills due" reminder built on the bills view.
package push

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/easly1989/cloudbank/server/internal/netguard"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

const (
	vapidPublicKey  = "vapid_public_key"
	vapidPrivateKey = "vapid_private_key"
)

// Payload is the JSON the service worker receives and renders as a notification.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

// Service sends Web Push notifications and manages subscriptions.
type Service struct {
	db      *sql.DB
	q       *db.Queries
	rq      *db.Queries
	public  string
	private string
	subject string
	client  webpush.HTTPClient // nil → library default; injectable for tests
	// checkEndpoint vets a subscription's endpoint; tests without DNS swap it.
	checkEndpoint func(ctx context.Context, endpoint string) error
	logger        *slog.Logger
}

// NewService loads (or generates and persists) the VAPID keypair and returns a
// ready Service. subject is the VAPID contact (a mailto: or https: URL).
func NewService(read, write *sql.DB, subject string, logger *slog.Logger) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	q := db.New(write)
	pub, priv, err := ensureVAPID(context.Background(), q)
	if err != nil {
		return nil, err
	}
	if subject == "" {
		subject = "mailto:cloudbank@localhost"
	}
	return &Service{
		db: write, q: q, rq: db.New(read),
		public: pub, private: priv, subject: subject, logger: logger,
		// A subscription's endpoint comes from the user's browser: it may only
		// reach the public internet, where every push service lives (#543).
		client: &http.Client{Timeout: 30 * time.Second, Transport: netguard.Transport()},
		checkEndpoint: func(ctx context.Context, endpoint string) error {
			return netguard.CheckURL(ctx, endpoint, true)
		},
	}, nil
}

// PublicKey returns the VAPID public key the client subscribes with.
func (s *Service) PublicKey() string { return s.public }

func ensureVAPID(ctx context.Context, q *db.Queries) (pub, priv string, err error) {
	pub, err = q.GetAppConfig(ctx, vapidPublicKey)
	if err == nil {
		priv, err = q.GetAppConfig(ctx, vapidPrivateKey)
	}
	if err == nil && pub != "" && priv != "" {
		return pub, secrets.Open(priv), nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", "", err
	}
	priv, pub, err = webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	if err := q.SetAppConfig(ctx, db.SetAppConfigParams{Key: vapidPublicKey, Value: pub}); err != nil {
		return "", "", err
	}
	if err := q.SetAppConfig(ctx, db.SetAppConfigParams{Key: vapidPrivateKey, Value: secrets.Seal(priv)}); err != nil {
		return "", "", err
	}
	return pub, priv, nil
}

// Subscribe records (or refreshes) a browser's push subscription.
func (s *Service) Subscribe(ctx context.Context, userID int64, endpoint, p256dh, auth string) error {
	if endpoint == "" || p256dh == "" || auth == "" {
		return errors.New("push: incomplete subscription")
	}
	if err := s.checkEndpoint(ctx, endpoint); err != nil {
		return fmt.Errorf("push: endpoint: %w", err)
	}
	return s.q.UpsertPushSubscription(ctx, db.UpsertPushSubscriptionParams{
		UserID: userID, Endpoint: endpoint, P256dh: p256dh, Auth: auth,
	})
}

// Unsubscribe removes a browser's subscription.
func (s *Service) Unsubscribe(ctx context.Context, userID int64, endpoint string) error {
	return s.q.DeletePushSubscription(ctx, db.DeletePushSubscriptionParams{UserID: userID, Endpoint: endpoint})
}

// SendToUser pushes a payload to every one of the user's subscriptions, pruning
// any the push service reports as gone (404/410).
func (s *Service) SendToUser(ctx context.Context, userID int64, p Payload) error {
	subs, err := s.rq.ListPushSubscriptionsForUser(ctx, userID)
	if err != nil {
		return err
	}
	msg, err := json.Marshal(p)
	if err != nil {
		return err
	}
	for _, sub := range subs {
		resp, err := webpush.SendNotificationWithContext(ctx, msg, &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
		}, &webpush.Options{
			HTTPClient:      s.client,
			Subscriber:      s.subject,
			VAPIDPublicKey:  s.public,
			VAPIDPrivateKey: s.private,
			TTL:             86400,
		})
		if err != nil {
			s.logger.Warn("push send failed", "endpoint", sub.Endpoint, "err", err)
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
			_ = s.q.DeletePushSubscriptionByEndpoint(ctx, sub.Endpoint)
		}
	}
	return nil
}
