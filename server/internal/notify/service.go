// Package notify is the one way CloudBank tells a person something (#683). A
// domain names an event and who it is for; the dispatcher applies that
// person's choices, keeps the event in the bell (the in-app channel) and hands
// it to every other channel they have on.
package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Kind names an event. The catalog below lists every one.
type Kind string

// The events that exist today; each has an entry in Catalog.
const (
	KindBills            Kind = "bills"
	KindMailStopped      Kind = "mail_stopped"
	KindMailUnrecognized Kind = "mail_unrecognized"
	KindBankSyncFailed   Kind = "bank_sync_failed"
	KindConsentExpiring  Kind = "consent_expiring"
	KindNewDevice        Kind = "new_device"
	KindTwoFactorOff     Kind = "two_factor_off"
	KindNewAPIToken      Kind = "new_api_token"
	KindNewVersion       Kind = "new_version"
)

// Group is how the settings page and the bell sort events.
type Group string

// The groups of the catalog.
const (
	GroupSecurity Group = "security"
	GroupProblems Group = "problems"
	GroupBills    Group = "bills"
	// GroupAdmin is for administrators only: nobody else sees or gets it.
	GroupAdmin Group = "admin"
)

// Channel is where an event can reach a person.
type Channel string

// The channels: the bell, push, and the ones a person sets up with an
// address (#686–#689).
const (
	ChannelInApp    Channel = "inapp"
	ChannelPush     Channel = "push"
	ChannelEmail    Channel = "email"
	ChannelMatrix   Channel = "matrix"
	ChannelTelegram Channel = "telegram"
	ChannelDiscord  Channel = "discord"
	ChannelSlack    Channel = "slack"
	ChannelNtfy     Channel = "ntfy"
	ChannelGotify   Channel = "gotify"
	ChannelWebhook  Channel = "webhook"
)

// Channels lists every channel, in the order the settings page shows them.
var Channels = []Channel{ChannelInApp, ChannelPush, ChannelEmail, ChannelMatrix, ChannelTelegram, ChannelDiscord, ChannelSlack, ChannelNtfy, ChannelGotify, ChannelWebhook}

// addressed reports whether a channel needs the person's own address (a row
// in notification_channels) before anything can be sent on it.
func addressed(ch Channel) bool { return ch != ChannelInApp && ch != ChannelPush }

// EventInfo is one entry of the catalog: the event's group and whether it is
// on for someone who never changed it.
type EventInfo struct {
	Kind    Kind
	Group   Group
	Default bool
}

// Catalog lists every event, in the order the settings page shows them.
// Security, problems, bills and admin are on by default; money events, when
// they come, are not. A security event always reaches the bell (#690).
var Catalog = []EventInfo{
	{Kind: KindNewDevice, Group: GroupSecurity, Default: true},
	{Kind: KindTwoFactorOff, Group: GroupSecurity, Default: true},
	{Kind: KindNewAPIToken, Group: GroupSecurity, Default: true},
	{Kind: KindBankSyncFailed, Group: GroupProblems, Default: true},
	{Kind: KindConsentExpiring, Group: GroupProblems, Default: true},
	{Kind: KindMailStopped, Group: GroupProblems, Default: true},
	{Kind: KindMailUnrecognized, Group: GroupProblems, Default: true},
	{Kind: KindBills, Group: GroupBills, Default: true},
	{Kind: KindNewVersion, Group: GroupAdmin, Default: true},
}

func info(k Kind) (EventInfo, bool) {
	for _, e := range Catalog {
		if e.Kind == k {
			return e, true
		}
	}
	return EventInfo{}, false
}

// Event is one thing to tell one person, already in their language. It is
// queued as JSON.
type Event struct {
	Kind Kind `json:"kind"`
	// Ref makes the event once only: a second event with the same ref for the
	// same person is dropped. Empty means always deliver.
	Ref   string `json:"-"`
	Title string `json:"title"`
	Body  string `json:"body"`
	// URL is the page the event opens, inside the app.
	URL string `json:"url"`
	// WalletID is the wallet the event is about, 0 for none.
	WalletID int64 `json:"walletId,omitempty"`
	// Test marks the message "Send a test" sends.
	Test bool `json:"test,omitempty"`
}

// Recipient is who a sender delivers to: the person, and for an addressed
// channel their address on it.
type Recipient struct {
	UserID int64
	// Target is the email address, the Matrix room, the Telegram chat, the
	// ntfy topic or the webhook URL (a Discord or Slack one included), opened;
	// empty for Gotify.
	Target string
	// Secret is the webhook's signing secret, the Matrix or Telegram bot's
	// token, or the ntfy or Gotify token, opened; empty for none.
	Secret string
	// Server is the person's Matrix homeserver (empty for the shared bot), or
	// their ntfy or Gotify server.
	Server string
	// Options are the channel's own settings (Telegram's topic and sound).
	Options ChannelOptions
	// LocalOK lets the delivery reach the local network: the channel was saved
	// by an administrator.
	LocalOK bool
}

// ChannelOptions are the settings only some channels have (#688).
type ChannelOptions struct {
	// Topic is the Telegram topic (message_thread_id) in a group with topics.
	Topic int64 `json:"topic,omitempty"`
	// Silent sends a Telegram message without sound.
	Silent bool `json:"silent,omitempty"`
}

// Sender delivers an event on one channel other than the bell. Its errors are
// best a *DeliveryError; anything else counts as unreachable.
type Sender interface {
	Send(ctx context.Context, to Recipient, e Event) error
}

// SenderFunc lets a plain function be a Sender.
type SenderFunc func(ctx context.Context, to Recipient, e Event) error

// Send calls f.
func (f SenderFunc) Send(ctx context.Context, to Recipient, e Event) error { return f(ctx, to, e) }

// ErrUnknownEvent is returned for a kind or channel the catalog does not list.
var ErrUnknownEvent = errors.New("notify: unknown event or channel")

// Service is the dispatcher, the bell's store, the person's choices and the
// delivery queue.
type Service struct {
	q       *db.Queries
	rq      *db.Queries
	senders map[Channel]Sender
	bills   *bills.Service
	logger  *slog.Logger
	// wake tells the delivery worker something was queued.
	wake chan struct{}
	now  func() time.Time
	// tested is when each person last sent a test to each address.
	testMu sync.Mutex
	tested map[string]time.Time
	// limit is the hourly cap on what goes through the installation's
	// resources, per person and channel, and sent the recent deliveries it
	// counts (#716).
	limit  int
	sentMu sync.Mutex
	sent   map[string][]time.Time
}

// NewService returns a dispatcher with only the in-app channel.
func NewService(read, write *sql.DB, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		q: db.New(write), rq: db.New(read), senders: map[Channel]Sender{}, logger: logger,
		wake: make(chan struct{}, 1), now: time.Now, tested: map[string]time.Time{},
		limit: defaultHourlyLimit, sent: map[string][]time.Time{},
	}
}

// SetSender wires a channel. Without one, that channel is never used.
func (s *Service) SetSender(ch Channel, snd Sender) { s.senders[ch] = snd }

// SetBills wires the bills service the reminders read.
func (s *Service) SetBills(b *bills.Service) { s.bills = b }

// Notify tells one person about one event, on every channel they have on for
// it: at once in the bell, and through the delivery queue everywhere else.
func (s *Service) Notify(ctx context.Context, userID int64, e Event) error {
	ev, ok := info(e.Kind)
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownEvent, e.Kind)
	}
	if e.Ref != "" {
		n, err := s.q.InsertReminderIfNew(ctx, db.InsertReminderIfNewParams{UserID: userID, Ref: e.Ref})
		if err != nil || n == 0 {
			return err
		}
	}
	on, err := s.enabled(ctx, userID, ev)
	if err != nil {
		return err
	}
	if on[ChannelInApp] {
		if err := s.q.InsertNotification(ctx, db.InsertNotificationParams{
			UserID: userID, Kind: string(e.Kind), Title: e.Title, Body: e.Body, Url: e.URL,
			WalletID: sql.NullInt64{Int64: e.WalletID, Valid: e.WalletID != 0},
		}); err != nil {
			return err
		}
	}
	set, err := s.addressedChannels(ctx, userID)
	if err != nil {
		return err
	}
	queued := false
	for _, ch := range Channels {
		if s.senders[ch] == nil || !on[ch] || (addressed(ch) && !set[ch]) {
			continue
		}
		if err := s.enqueue(ctx, userID, ch, e); err != nil {
			return err
		}
		queued = true
	}
	if queued {
		s.kick()
	}
	return nil
}

// NotifyWallet tells every member of a wallet, each in their own language
// (build gets internal/locale's code). The event is about that wallet.
func (s *Service) NotifyWallet(ctx context.Context, walletID int64, build func(locale string) Event) error {
	rows, err := s.rq.ListWalletRecipients(ctx, walletID)
	if err != nil {
		return err
	}
	var errs []error
	for _, r := range rows {
		e := build(r.Locale)
		e.WalletID = walletID
		errs = append(errs, s.Notify(ctx, r.ID, e))
	}
	return errors.Join(errs...)
}

// NotifyAdmins tells every administrator, each in their own language. Only an
// admin event may go this way.
func (s *Service) NotifyAdmins(ctx context.Context, build func(locale string) Event) error {
	rows, err := s.rq.ListAdminRecipients(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, r := range rows {
		errs = append(errs, s.Notify(ctx, r.ID, build(r.Locale)))
	}
	return errors.Join(errs...)
}

// addressedChannels is which addressed channels the person has set up and,
// where it was needed, proved.
func (s *Service) addressedChannels(ctx context.Context, userID int64) (map[Channel]bool, error) {
	rows, err := s.rq.ListNotificationChannels(ctx, userID)
	if err != nil {
		return nil, err
	}
	set := map[Channel]bool{}
	for _, r := range rows {
		set[Channel(r.Channel)] = r.Verified != 0
	}
	return set, nil
}

// enabled is which channels carry ev for this person: what they chose, else
// the event's default.
func (s *Service) enabled(ctx context.Context, userID int64, ev EventInfo) (map[Channel]bool, error) {
	prefs, err := s.rq.ListNotificationPrefs(ctx, userID)
	if err != nil {
		return nil, err
	}
	return channelsFor(ev, prefs), nil
}

// channelsFor applies the person's choices to the event's default. A
// security event stays in the bell whatever they chose.
func channelsFor(ev EventInfo, prefs []db.ListNotificationPrefsRow) map[Channel]bool {
	on := map[Channel]bool{}
	for _, ch := range Channels {
		on[ch] = ev.Default
	}
	for _, p := range prefs {
		if Kind(p.Kind) == ev.Kind {
			on[Channel(p.Channel)] = p.Enabled != 0
		}
	}
	if ev.Group == GroupSecurity {
		on[ChannelInApp] = true
	}
	return on
}

// Preference is one event with the channels that carry it, for one person.
type Preference struct {
	Kind     Kind
	Group    Group
	Channels map[Channel]bool
}

// Preferences lists every event in the catalog with this person's choices;
// the admin events only for an administrator.
func (s *Service) Preferences(ctx context.Context, userID int64, admin bool) ([]Preference, error) {
	prefs, err := s.rq.ListNotificationPrefs(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Preference, 0, len(Catalog))
	for _, ev := range Catalog {
		if ev.Group == GroupAdmin && !admin {
			continue
		}
		out = append(out, Preference{Kind: ev.Kind, Group: ev.Group, Channels: channelsFor(ev, prefs)})
	}
	return out, nil
}

// ErrAlwaysOn is returned for turning a security event off in the bell.
var ErrAlwaysOn = errors.New("notify: security events always reach the bell")

// SetPreference turns one event on or off on one channel for this person.
func (s *Service) SetPreference(ctx context.Context, userID int64, k Kind, ch Channel, on bool) error {
	ev, ok := info(k)
	if !ok || !knownChannel(ch) {
		return ErrUnknownEvent
	}
	if ev.Group == GroupSecurity && ch == ChannelInApp && !on {
		return ErrAlwaysOn
	}
	v := int64(0)
	if on {
		v = 1
	}
	return s.q.SetNotificationPref(ctx, db.SetNotificationPrefParams{UserID: userID, Kind: string(k), Channel: string(ch), Enabled: v})
}

func knownChannel(ch Channel) bool {
	for _, c := range Channels {
		if c == ch {
			return true
		}
	}
	return false
}

// Notification is one entry of the bell.
type Notification struct {
	ID        int64
	Kind      Kind
	Title     string
	Body      string
	URL       string
	WalletID  int64
	CreatedAt string
	Read      bool
}

// listLimit caps the bell: 90 days of a busy person is still well under it.
const listLimit = 200

// List returns the person's bell, newest first, and how many are unread.
func (s *Service) List(ctx context.Context, userID int64) ([]Notification, int64, error) {
	rows, err := s.rq.ListNotifications(ctx, db.ListNotificationsParams{UserID: userID, Lim: listLimit})
	if err != nil {
		return nil, 0, err
	}
	unread, err := s.rq.CountUnreadNotifications(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Notification, 0, len(rows))
	for _, r := range rows {
		out = append(out, Notification{
			ID: r.ID, Kind: Kind(r.Kind), Title: r.Title, Body: r.Body, URL: r.Url,
			WalletID: r.WalletID.Int64, CreatedAt: r.CreatedAt, Read: r.ReadAt.Valid,
		})
	}
	return out, unread, nil
}

// MarkRead marks one of the person's notifications read. Someone else's, or
// one already read, changes nothing.
func (s *Service) MarkRead(ctx context.Context, userID, id int64) error {
	_, err := s.q.MarkNotificationRead(ctx, db.MarkNotificationReadParams{ID: id, UserID: userID})
	return err
}

// MarkAllRead marks every one of the person's notifications read.
func (s *Service) MarkAllRead(ctx context.Context, userID int64) error {
	return s.q.MarkAllNotificationsRead(ctx, userID)
}

// retention is how long the bell keeps a notification.
const retention = 90 * 24 * time.Hour

// Purge deletes the notifications older than the retention.
func (s *Service) Purge(ctx context.Context, now time.Time) error {
	_, err := s.q.PurgeNotificationsBefore(ctx, now.UTC().Add(-retention).Format("2006-01-02T15:04:05.000Z"))
	return err
}

// Run purges old notifications and sends the bills reminders at start, then
// once a day, and delivers the queue, until ctx ends.
func (s *Service) Run(ctx context.Context) {
	go s.runDeliveries(ctx)
	run := func() {
		now := time.Now().UTC()
		if err := s.Purge(ctx, now); err != nil {
			s.logger.Error("notifications purge failed", "error", err)
		}
		if err := s.RunBillsReminders(ctx, now); err != nil {
			s.logger.Error("bills reminders job failed", "error", err)
		}
	}
	run()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
