package notify

import (
	"context"
	"database/sql"
	"encoding/json"
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
	// ErrBadTarget means the target is not an email address, a Matrix room ID,
	// a Telegram chat or an http(s) URL, or a part the channel needs is missing.
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
	// Target is the email address, the Matrix room, the Telegram chat, or only
	// a webhook's host (Discord and Slack included): the rest of its URL is
	// often its key and never leaves the server.
	Target    string
	HasSecret bool
	// Server is the person's Matrix homeserver, empty when the shared bot
	// posts.
	Server string
	// Options are the channel's own settings.
	Options ChannelOptions
	// Shared is true when the installation has a shared Matrix or Telegram
	// bot, and Bot is that bot's Matrix ID or @username once known.
	Shared bool
	Bot    string
	// Pending is true while the address waits for its code (#716); Link and
	// GroupLink are then, for Telegram's shared bot, the links that start it
	// with the code, empty once it expired.
	Pending     bool
	Link        string
	GroupLink   string
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
	for _, r := range rows {
		// The page waits on a Telegram link: see whether it was used.
		if Channel(r.Channel) == ChannelTelegram && r.Verified == 0 {
			s.linkTelegram(ctx)
			if rows, err = s.rq.ListNotificationChannels(ctx, userID); err != nil {
				return nil, err
			}
			break
		}
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
		switch snd := s.senders[ch].(type) {
		case *MatrixSender:
			info.Shared, info.Bot = snd.Shared(), snd.BotUser(ctx)
		case *TelegramSender:
			info.Shared, info.Bot = snd.Shared(), snd.BotName(ctx)
		}
		if r, ok := byCh[ch]; ok {
			info.Configured = true
			info.Target = shownTarget(ch, secrets.Open(r.Target))
			info.HasSecret = r.Secret != ""
			info.Server = r.Server
			info.Options = parseOptions(r.Options)
			info.LastError, info.LastErrorAt, info.LastOKAt = r.LastError, r.LastErrorAt.String, r.LastOkAt.String
			info.Pending = r.Verified == 0
			if info.Pending && ch == ChannelTelegram {
				info.Link, info.GroupLink = s.telegramLinks(r, info.Bot)
			}
		}
		out = append(out, info)
	}
	return out, nil
}

func shownTarget(ch Channel, target string) string {
	if ch != ChannelWebhook && ch != ChannelDiscord && ch != ChannelSlack {
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
	// Options replace the channel's own settings; nil keeps them. Only
	// Telegram has any.
	Options *ChannelOptions
	// Lang is the language of the code a new address is sent.
	Lang string
}

// SaveChannel sets a person's address on a channel. A webhook or homeserver
// on the local network needs admin; the address is checked again with the
// current role on every save. A new address reached through the
// installation's resources waits for its code: email and Matrix are sent one
// now, and a failure to send it saves nothing; Telegram's shared bot gets a
// link, and the chat is whichever one uses it.
func (s *Service) SaveChannel(ctx context.Context, userID int64, admin bool, ch Channel, in ChannelInput) error {
	if !addressed(ch) || s.senders[ch] == nil {
		return ErrChannelUnavailable
	}
	old, err := s.rq.GetNotificationChannel(ctx, db.GetNotificationChannelParams{UserID: userID, Channel: string(ch)})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	exists := err == nil
	oldT := secrets.Open(old.Target)
	oldVia := exists && viaInstallation(ch, rowRecipient(userID, old))
	t := oldT
	if in.Target != nil {
		t = strings.TrimSpace(*in.Target)
	} else if !exists {
		return ErrBadTarget
	}
	sec := secrets.Open(old.Secret)
	if in.Secret != nil {
		sec = strings.TrimSpace(*in.Secret)
	}
	opts := parseOptions(old.Options)
	if in.Options != nil {
		opts = *in.Options
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
	case ChannelTelegram:
		srv = ""
		if sec == "" {
			if !s.senders[ch].(*TelegramSender).Shared() {
				return ErrBadTarget
			}
			// The shared bot learns the chat from the link, never from the page.
			t = ""
			if oldVia {
				t = oldT
			}
		} else if !telegramToken.MatchString(sec) || !telegramChat.MatchString(t) {
			return ErrBadTarget
		}
		if opts.Topic < 0 {
			return ErrBadTarget
		}
	default:
		// The webhook, and Discord's or Slack's incoming webhook.
		if err := checkServerURL(ctx, t, admin); err != nil {
			return err
		}
		srv = ""
		if ch != ChannelWebhook {
			sec = ""
		}
	}
	if ch != ChannelTelegram {
		opts = ChannelOptions{}
	}
	optsJSON := ""
	if opts != (ChannelOptions{}) {
		b, _ := json.Marshal(opts)
		optsJSON = string(b)
	}
	sealed := ""
	if sec != "" {
		sealed = secrets.Seal(sec)
	}
	localOK := int64(0)
	if admin {
		localOK = 1
	}
	p := db.UpsertNotificationChannelParams{
		UserID: userID, Channel: string(ch), Target: secrets.Seal(t), Secret: sealed, Server: srv, Options: optsJSON, LocalOk: localOK,
		Verified: 1,
	}
	to := Recipient{UserID: userID, Target: t, Secret: sec, Server: srv, Options: opts, LocalOK: admin}
	switch via := viaInstallation(ch, to); {
	case exists && t == oldT && via == oldVia:
		// Nothing to prove changed: the channel keeps its state, a pending
		// code included.
		p.Verified, p.CodeHash, p.CodeLink, p.CodeExpiresAt, p.CodeAttempts = old.Verified, old.CodeHash, old.CodeLink, old.CodeExpiresAt, old.CodeAttempts
	case via:
		c, err := s.issueCode(ctx, in.Lang, ch, to)
		if err != nil {
			return err
		}
		p.Verified, p.CodeHash, p.CodeLink, p.CodeExpiresAt = 0, c.hash, c.link, c.expires
	}
	return s.q.UpsertNotificationChannel(ctx, p)
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
	if ok, _ := s.allow(ch, to); !ok {
		return ErrHourlyLimit
	}
	text := locale.Pick(testTexts, lang)
	if err := snd.Send(ctx, to, Event{Kind: "test", Title: text.title, Body: text.body, URL: "/settings/notifications/" + string(ch), Test: true}); err != nil {
		de := asDeliveryError(err)
		s.recordError(ctx, userID, ch, de)
		return de
	}
	s.recordOK(ctx, userID, ch)
	return nil
}
