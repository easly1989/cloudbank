package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/netguard"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

var (
	// ErrChannelUnavailable means this installation cannot send on that channel
	// (email with no SMTP server configured), or it is not one a person sets up.
	ErrChannelUnavailable = errors.New("notify: channel not available")
	// ErrBadTarget means the target is not an email address, or not an http(s) URL.
	ErrBadTarget = errors.New("notify: invalid address")
	// ErrLocalTarget means a webhook on the local network, saved by someone who is
	// not an administrator.
	ErrLocalTarget = errors.New("notify: only an administrator can send to the local network")
	// ErrNotSetUp means the channel has no address yet.
	ErrNotSetUp = errors.New("notify: channel not set up")
	// ErrTooSoon means the person sent a test to that address moments ago.
	ErrTooSoon = errors.New("notify: a test was sent moments ago")
)

// testEvery is the least time between two tests to one address, so the button
// cannot turn the installation's mail server into a way to flood it.
const testEvery = 10 * time.Second

// ChannelInfo is an addressed channel as the settings page shows it.
type ChannelInfo struct {
	Channel Channel
	// Available is false when the installation cannot send on it.
	Available  bool
	Configured bool
	// Target is the email address, or only the webhook's host: the rest of
	// its URL is often its key and never leaves the server.
	Target      string
	HasSecret   bool
	LastError   string
	LastErrorAt string
	LastOKAt    string
}

// AddressedChannels lists the channels a person sets up with an address, with
// their state.
func (s *Service) AddressedChannels(ctx context.Context, userID int64) ([]ChannelInfo, error) {
	rows, err := s.rq.ListNotificationChannels(ctx, userID)
	if err != nil {
		return nil, err
	}
	byCh := map[Channel]db.NotificationChannel{}
	for _, r := range rows {
		byCh[Channel(r.Channel)] = r
	}
	var out []ChannelInfo
	for _, ch := range Channels {
		if !addressed(ch) {
			continue
		}
		info := ChannelInfo{Channel: ch, Available: s.senders[ch] != nil}
		if r, ok := byCh[ch]; ok {
			info.Configured = true
			info.Target = shownTarget(ch, secrets.Open(r.Target))
			info.HasSecret = r.Secret != ""
			info.LastError, info.LastErrorAt, info.LastOKAt = r.LastError, r.LastErrorAt.String, r.LastOkAt.String
		}
		out = append(out, info)
	}
	return out, nil
}

func shownTarget(ch Channel, target string) string {
	if ch != ChannelWebhook {
		return target
	}
	if u, err := url.Parse(target); err == nil {
		return u.Host
	}
	return ""
}

// SaveChannel sets a person's address on a channel. A nil target keeps the
// stored one (the webhook URL is never sent back, so the page cannot resend
// it), a nil secret keeps the stored secret and an empty one removes it. A
// webhook on the local network needs admin; the address is checked again with
// the current role on every save.
func (s *Service) SaveChannel(ctx context.Context, userID int64, admin bool, ch Channel, target, secret *string) error {
	if !addressed(ch) || s.senders[ch] == nil {
		return ErrChannelUnavailable
	}
	old, err := s.rq.GetNotificationChannel(ctx, db.GetNotificationChannelParams{UserID: userID, Channel: string(ch)})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	exists := err == nil
	t := secrets.Open(old.Target)
	if target != nil {
		t = strings.TrimSpace(*target)
	} else if !exists {
		return ErrBadTarget
	}
	sec := secrets.Open(old.Secret)
	if secret != nil {
		sec = strings.TrimSpace(*secret)
	}
	if ch == ChannelEmail {
		a, err := mail.ParseAddress(t)
		if err != nil {
			return ErrBadTarget
		}
		t, sec = a.Address, ""
	} else if err := checkWebhook(ctx, t, admin); err != nil {
		return err
	}
	sealed := ""
	if sec != "" {
		sealed = secrets.Seal(sec)
	}
	localOK := int64(0)
	if admin {
		localOK = 1
	}
	return s.q.UpsertNotificationChannel(ctx, db.UpsertNotificationChannelParams{
		UserID: userID, Channel: string(ch), Target: secrets.Seal(t), Secret: sealed, LocalOk: localOK,
	})
}

func checkWebhook(ctx context.Context, raw string, admin bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return ErrBadTarget
	}
	if admin {
		return nil
	}
	switch err := netguard.CheckURL(ctx, raw, false); {
	case err == nil:
		return nil
	case errors.Is(err, netguard.ErrNotPublic):
		return ErrLocalTarget
	default:
		return ErrBadTarget
	}
}

// DeleteChannel removes a person's address on a channel; what was queued for
// it is dropped when it comes due.
func (s *Service) DeleteChannel(ctx context.Context, userID int64, ch Channel) error {
	if !addressed(ch) {
		return ErrChannelUnavailable
	}
	return s.q.DeleteNotificationChannel(ctx, db.DeleteNotificationChannelParams{UserID: userID, Channel: string(ch)})
}

// testText is the test message, one per language (internal/locale's codes).
type testText struct{ title, body string }

var testTexts = map[string]testText{
	"en":    {"CloudBank: a test", "If you can read this, CloudBank can reach you here."},
	"it":    {"CloudBank: una prova", "Se leggi questo messaggio, CloudBank riesce a raggiungerti qui."},
	"es":    {"CloudBank: una prueba", "Si puedes leer esto, CloudBank puede avisarte aquí."},
	"fr":    {"CloudBank : un test", "Si vous lisez ceci, CloudBank peut vous joindre ici."},
	"de":    {"CloudBank: ein Test", "Wenn du das liest, kann CloudBank dich hier erreichen."},
	"pt-BR": {"CloudBank: um teste", "Se você está lendo isto, o CloudBank consegue avisar você aqui."},
}

// TestChannel sends a test message on a channel now, not through the queue,
// writes the outcome on the channel and returns the failure, if any.
func (s *Service) TestChannel(ctx context.Context, userID int64, lang string, ch Channel) error {
	snd := s.senders[ch]
	if ch == ChannelInApp || snd == nil {
		return ErrChannelUnavailable
	}
	to, ok, err := s.recipient(ctx, userID, ch)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotSetUp
	}
	key := fmt.Sprint(userID, ch, to.Target)
	s.testMu.Lock()
	if last, seen := s.tested[key]; seen && s.now().Sub(last) < testEvery {
		s.testMu.Unlock()
		return ErrTooSoon
	}
	s.tested[key] = s.now()
	s.testMu.Unlock()
	text := locale.Pick(testTexts, lang)
	if err := snd.Send(ctx, to, Event{Kind: "test", Title: text.title, Body: text.body, URL: "/settings/notifications", Test: true}); err != nil {
		de := asDeliveryError(err)
		s.recordError(ctx, userID, ch, de)
		return de
	}
	s.recordOK(ctx, userID, ch)
	return nil
}
