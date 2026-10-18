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
	// ErrBadTarget means the target is not an email address, a Matrix room ID
	// or an http(s) URL, or a part the channel needs is missing.
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
	// Target is the email address, the Matrix room, or only the webhook's
	// host: the rest of its URL is often its key and never leaves the server.
	Target    string
	HasSecret bool
	// Server is the person's Matrix homeserver, empty when the shared bot
	// posts.
	Server string
	// Shared is true when the installation has a shared Matrix bot, and Bot
	// is that bot's Matrix ID when its homeserver told it.
	Shared      bool
	Bot         string
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
		if m, ok := s.senders[ch].(*MatrixSender); ok {
			info.Shared, info.Bot = m.Shared(), m.BotUser(ctx)
		}
		if r, ok := byCh[ch]; ok {
			info.Configured = true
			info.Target = shownTarget(ch, secrets.Open(r.Target))
			info.HasSecret = r.Secret != ""
			info.Server = r.Server
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

// ChannelInput is what a person saves on a channel. A nil field keeps the
// stored value (the webhook URL and the secrets are never sent back, so the
// page cannot resend them); an empty secret or server removes it.
type ChannelInput struct {
	// Target is the email address, the Matrix room ID or the webhook URL.
	Target *string
	// Secret is the webhook's signing secret or the Matrix access token.
	Secret *string
	// Server is the Matrix homeserver; empty to post as the shared bot.
	Server *string
}

// SaveChannel sets a person's address on a channel. A webhook or homeserver
// on the local network needs admin; the address is checked again with the
// current role on every save.
func (s *Service) SaveChannel(ctx context.Context, userID int64, admin bool, ch Channel, in ChannelInput) error {
	if !addressed(ch) || s.senders[ch] == nil {
		return ErrChannelUnavailable
	}
	old, err := s.rq.GetNotificationChannel(ctx, db.GetNotificationChannelParams{UserID: userID, Channel: string(ch)})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	exists := err == nil
	t := secrets.Open(old.Target)
	if in.Target != nil {
		t = strings.TrimSpace(*in.Target)
	} else if !exists {
		return ErrBadTarget
	}
	sec := secrets.Open(old.Secret)
	if in.Secret != nil {
		sec = strings.TrimSpace(*in.Secret)
	}
	srv := old.Server
	if in.Server != nil {
		srv = strings.TrimRight(strings.TrimSpace(*in.Server), "/")
	}
	switch ch {
	case ChannelEmail:
		a, err := mail.ParseAddress(t)
		if err != nil {
			return ErrBadTarget
		}
		t, sec, srv = a.Address, "", ""
	case ChannelMatrix:
		// A room ID, "!opaque:server"; an alias would need resolving.
		if !strings.HasPrefix(t, "!") || !strings.Contains(t, ":") {
			return ErrBadTarget
		}
		if srv == "" {
			// The shared bot posts: nothing of the person's own to keep.
			if !s.senders[ch].(*MatrixSender).Shared() {
				return ErrBadTarget
			}
			sec = ""
		} else if sec == "" {
			return ErrBadTarget
		} else if err := checkServerURL(ctx, srv, admin); err != nil {
			return err
		}
	default:
		if err := checkServerURL(ctx, t, admin); err != nil {
			return err
		}
		srv = ""
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
		UserID: userID, Channel: string(ch), Target: secrets.Seal(t), Secret: sealed, Server: srv, LocalOk: localOK,
	})
}

// checkServerURL checks a URL CloudBank will call: http(s), no credentials in
// it, and on the public internet unless an administrator saves it.
func checkServerURL(ctx context.Context, raw string, admin bool) error {
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
	// A fixed token or homeserver deserves a test at once, like a new address.
	key := fmt.Sprint(userID, ch, to.Target, to.Server, to.Secret)
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
