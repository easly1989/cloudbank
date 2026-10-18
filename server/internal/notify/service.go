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
)

// Group is how the settings page and the bell sort events.
type Group string

// The groups of the catalog.
const (
	GroupProblems Group = "problems"
	GroupBills    Group = "bills"
)

// Channel is where an event can reach a person.
type Channel string

// The channels: the bell, and push.
const (
	ChannelInApp Channel = "inapp"
	ChannelPush  Channel = "push"
)

// Channels lists every channel, in the order the settings page shows them.
var Channels = []Channel{ChannelInApp, ChannelPush}

// EventInfo is one entry of the catalog: the event's group and whether it is
// on for someone who never changed it.
type EventInfo struct {
	Kind    Kind
	Group   Group
	Default bool
}

// Catalog lists every event, in the order the settings page shows them.
// Problems and bills are on by default; money events, when they come, are not.
var Catalog = []EventInfo{
	{Kind: KindMailStopped, Group: GroupProblems, Default: true},
	{Kind: KindMailUnrecognized, Group: GroupProblems, Default: true},
	{Kind: KindBills, Group: GroupBills, Default: true},
}

func info(k Kind) (EventInfo, bool) {
	for _, e := range Catalog {
		if e.Kind == k {
			return e, true
		}
	}
	return EventInfo{}, false
}

// Event is one thing to tell one person, already in their language.
type Event struct {
	Kind Kind
	// Ref makes the event once only: a second event with the same ref for the
	// same person is dropped. Empty means always deliver.
	Ref   string
	Title string
	Body  string
	// URL is the page the event opens, inside the app.
	URL string
	// WalletID is the wallet the event is about, 0 for none.
	WalletID int64
}

// Sender delivers an event on one channel other than the bell.
type Sender interface {
	Send(ctx context.Context, userID int64, e Event) error
}

// SenderFunc lets a plain function be a Sender.
type SenderFunc func(ctx context.Context, userID int64, e Event) error

// Send calls f.
func (f SenderFunc) Send(ctx context.Context, userID int64, e Event) error { return f(ctx, userID, e) }

// ErrUnknownEvent is returned for a kind or channel the catalog does not list.
var ErrUnknownEvent = errors.New("notify: unknown event or channel")

// Service is the dispatcher, the bell's store and the person's choices.
type Service struct {
	q       *db.Queries
	rq      *db.Queries
	senders map[Channel]Sender
	bills   *bills.Service
	logger  *slog.Logger
}

// NewService returns a dispatcher with only the in-app channel.
func NewService(read, write *sql.DB, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{q: db.New(write), rq: db.New(read), senders: map[Channel]Sender{}, logger: logger}
}

// SetSender wires a channel. Without one, that channel is never used.
func (s *Service) SetSender(ch Channel, snd Sender) { s.senders[ch] = snd }

// SetBills wires the bills service the reminders read.
func (s *Service) SetBills(b *bills.Service) { s.bills = b }

// Notify tells one person about one event, on every channel they have on for
// it. A sender that fails is logged and does not stop the others.
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
	for _, ch := range Channels {
		snd := s.senders[ch]
		if snd == nil || !on[ch] {
			continue
		}
		if err := snd.Send(ctx, userID, e); err != nil {
			s.logger.Warn("notification not delivered", "channel", ch, "kind", e.Kind, "user", userID, "err", err)
		}
	}
	return nil
}

// enabled is which channels carry ev for this person: what they chose, else
// the event's default.
func (s *Service) enabled(ctx context.Context, userID int64, ev EventInfo) (map[Channel]bool, error) {
	on := map[Channel]bool{}
	for _, ch := range Channels {
		on[ch] = ev.Default
	}
	prefs, err := s.rq.ListNotificationPrefs(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, p := range prefs {
		if Kind(p.Kind) == ev.Kind {
			on[Channel(p.Channel)] = p.Enabled != 0
		}
	}
	return on, nil
}

// Preference is one event with the channels that carry it, for one person.
type Preference struct {
	Kind     Kind
	Group    Group
	Channels map[Channel]bool
}

// Preferences lists every event in the catalog with this person's choices.
func (s *Service) Preferences(ctx context.Context, userID int64) ([]Preference, error) {
	prefs, err := s.rq.ListNotificationPrefs(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Preference, 0, len(Catalog))
	for _, ev := range Catalog {
		p := Preference{Kind: ev.Kind, Group: ev.Group, Channels: map[Channel]bool{}}
		for _, ch := range Channels {
			p.Channels[ch] = ev.Default
		}
		for _, r := range prefs {
			if Kind(r.Kind) == ev.Kind {
				p.Channels[Channel(r.Channel)] = r.Enabled != 0
			}
		}
		out = append(out, p)
	}
	return out, nil
}

// SetPreference turns one event on or off on one channel for this person.
func (s *Service) SetPreference(ctx context.Context, userID int64, k Kind, ch Channel, on bool) error {
	if _, ok := info(k); !ok || !knownChannel(ch) {
		return ErrUnknownEvent
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
// once a day, until ctx ends.
func (s *Service) Run(ctx context.Context) {
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
