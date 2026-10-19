package notify

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	// The zone database inside the binary: the image may have none.
	_ "time/tzdata"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// When a notification reaches a person outside the app (#692). The bell is
// always at once; push, email and the chat channels follow the person's daily
// digest and quiet hours.

// Settings are the person's notification settings that are not per event.
type Settings struct {
	// AmountsOutside lets amounts reach the channels outside the app (#691).
	AmountsOutside bool
	// Timezone is the person's IANA zone, from their browser; empty is UTC.
	Timezone string
	// DigestAt is the local "HH:MM" of the daily digest.
	DigestAt string
	// QuietHours holds what is not urgent from QuietFrom to QuietTo, local
	// "HH:MM"s, the end excluded; a span past midnight wraps.
	QuietHours         bool
	QuietFrom, QuietTo string
	// ReviewDays is how long a transaction may wait on the Review page before
	// it is announced.
	ReviewDays int
}

// defaultSettings are someone's who never changed anything.
var defaultSettings = Settings{AmountsOutside: true, DigestAt: "08:00", QuietFrom: "22:00", QuietTo: "07:00", ReviewDays: 3}

// ReviewDayChoices are the waits the settings page offers.
var ReviewDayChoices = []int{1, 3, 7, 14}

// ErrBadSettings is returned for a time zone, time or wait that is not valid.
var ErrBadSettings = errors.New("notify: invalid notification settings")

// GetSettings returns the person's settings, the defaults where they chose
// nothing.
func (s *Service) GetSettings(ctx context.Context, userID int64) (Settings, error) {
	r, err := s.rq.GetNotificationSettings(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return defaultSettings, nil
	}
	if err != nil {
		return Settings{}, err
	}
	return Settings{
		AmountsOutside: r.AmountsOutside != 0, Timezone: r.Timezone, DigestAt: r.DigestAt,
		QuietHours: r.QuietHours != 0, QuietFrom: r.QuietFrom, QuietTo: r.QuietTo, ReviewDays: int(r.ReviewDays),
	}, nil
}

// SetSettings saves the person's settings, refusing an unknown time zone, a
// time that is not "HH:MM" or a wait the page does not offer.
func (s *Service) SetSettings(ctx context.Context, userID int64, st Settings) error {
	if _, err := time.LoadLocation(st.Timezone); err != nil {
		return fmt.Errorf("%w: time zone %q", ErrBadSettings, st.Timezone)
	}
	for _, c := range []string{st.DigestAt, st.QuietFrom, st.QuietTo} {
		if clockMinutes(c) < 0 {
			return fmt.Errorf("%w: time %q", ErrBadSettings, c)
		}
	}
	if !slices.Contains(ReviewDayChoices, st.ReviewDays) {
		return fmt.Errorf("%w: %d days", ErrBadSettings, st.ReviewDays)
	}
	return s.q.UpsertNotificationSettings(ctx, db.UpsertNotificationSettingsParams{
		UserID: userID, AmountsOutside: flag(st.AmountsOutside), Timezone: st.Timezone, DigestAt: st.DigestAt,
		QuietHours: flag(st.QuietHours), QuietFrom: st.QuietFrom, QuietTo: st.QuietTo, ReviewDays: int64(st.ReviewDays),
	})
}

// SetAmountsOutside lets amounts reach the channels outside the app, or not.
func (s *Service) SetAmountsOutside(ctx context.Context, userID int64, on bool) error {
	st, err := s.GetSettings(ctx, userID)
	if err != nil {
		return err
	}
	st.AmountsOutside = on
	return s.SetSettings(ctx, userID, st)
}

func flag(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// clockMinutes is "HH:MM" as minutes after midnight, or -1.
func clockMinutes(c string) int {
	t, err := time.Parse("15:04", c)
	if err != nil || len(c) != 5 {
		return -1
	}
	return t.Hour()*60 + t.Minute()
}

// Location is the person's time zone; UTC when unknown.
func (st Settings) Location() *time.Location {
	if loc, err := time.LoadLocation(st.Timezone); err == nil {
		return loc
	}
	return time.UTC
}

// Quiet reports whether t falls in the person's quiet hours.
func (st Settings) Quiet(t time.Time) bool {
	if !st.QuietHours {
		return false
	}
	t = t.In(st.Location())
	m, from, to := t.Hour()*60+t.Minute(), clockMinutes(st.QuietFrom), clockMinutes(st.QuietTo)
	if from < to {
		return m >= from && m < to
	}
	return from != to && (m >= from || m < to)
}

// LastDigest is the person's most recent digest time at or before now, in
// their time zone.
func (st Settings) LastDigest(now time.Time) time.Time {
	local := now.In(st.Location())
	at := max(clockMinutes(st.DigestAt), 0)
	d := time.Date(local.Year(), local.Month(), local.Day(), at/60, at%60, 0, 0, local.Location())
	if d.After(local) {
		d = time.Date(local.Year(), local.Month(), local.Day()-1, at/60, at%60, 0, 0, local.Location())
	}
	return d
}

// Wants reports whether the person gets an event on any channel.
func (s *Service) Wants(ctx context.Context, userID int64, k Kind) (bool, error) {
	ev, ok := info(k)
	if !ok {
		return false, ErrUnknownEvent
	}
	on, err := s.enabled(ctx, userID, ev)
	if err != nil {
		return false, err
	}
	for _, v := range on {
		if v {
			return true, nil
		}
	}
	return false, nil
}

// digestKinds is which events the person collects in the digest.
func (s *Service) digestKinds(ctx context.Context, userID int64) (map[Kind]bool, error) {
	rows, err := s.rq.ListDigestKinds(ctx, userID)
	out := map[Kind]bool{}
	for _, k := range rows {
		out[Kind(k)] = true
	}
	return out, err
}

// ErrAlwaysImmediate is returned for putting in the digest an event that
// cannot wait (security) or is a digest already (the summaries).
var ErrAlwaysImmediate = errors.New("notify: this event cannot go in the digest")

// digestible reports whether an event may be collected in the digest.
func digestible(ev EventInfo) bool { return ev.Group != GroupSecurity && ev.Group != GroupSummaries }

// SetDigest collects one event in the person's digest, or sends it at once.
func (s *Service) SetDigest(ctx context.Context, userID int64, k Kind, digest bool) error {
	ev, ok := info(k)
	if !ok {
		return ErrUnknownEvent
	}
	if !digestible(ev) {
		return ErrAlwaysImmediate
	}
	if digest {
		return s.q.SetDigestKind(ctx, db.SetDigestKindParams{UserID: userID, Kind: string(k)})
	}
	return s.q.UnsetDigestKind(ctx, db.UnsetDigestKindParams{UserID: userID, Kind: string(k)})
}

// holdFor says whether an event waits before leaving the app, and for what:
// the digest if the person collects it there, else the end of the quiet
// hours for anything but security and problems. A test never waits.
func (s *Service) holdFor(ctx context.Context, userID int64, ev EventInfo, e Event) (held, digest bool, err error) {
	if e.Test || ev.Group == GroupSecurity {
		return false, false, nil
	}
	if digestible(ev) {
		kinds, err := s.digestKinds(ctx, userID)
		if err != nil || kinds[ev.Kind] {
			return err == nil, true, err
		}
	}
	if ev.Group == GroupProblems {
		return false, false, nil
	}
	st, err := s.GetSettings(ctx, userID)
	if err != nil {
		return false, false, err
	}
	return st.Quiet(s.now()), false, nil
}

// hold keeps an event for one channel until it may leave.
func (s *Service) hold(ctx context.Context, userID int64, ch Channel, e Event, digest bool) error {
	payload, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return s.q.InsertHeldNotification(ctx, db.InsertHeldNotificationParams{
		UserID: userID, Channel: string(ch), Payload: string(payload), Digest: flag(digest), HeldAt: stamp(s.now()),
	})
}

// KindDigest is the message that carries several held events at once. It is
// not in the catalog: nobody turns it on or off.
const KindDigest Kind = "digest"

// releaseHeld sends what may leave now: outside the quiet hours, what waited
// for them, and what waited for a digest time that has passed. On each
// channel a single event goes as itself, several as one digest; nothing held
// sends nothing.
func (s *Service) releaseHeld(ctx context.Context) {
	users, err := s.q.ListHeldUsers(ctx)
	if err != nil {
		s.logger.Error("held notifications", "error", err)
		return
	}
	now := s.now()
	queued := false
	for _, userID := range users {
		st, err := s.GetSettings(ctx, userID)
		if err != nil || st.Quiet(now) {
			continue
		}
		rows, err := s.q.ListHeldNotifications(ctx, userID)
		if err != nil {
			continue
		}
		last := stamp(st.LastDigest(now))
		byChannel := map[Channel][]db.NotificationHeld{}
		var order []Channel
		for _, r := range rows {
			if r.Digest != 0 && r.HeldAt >= last {
				continue // after today's digest: tomorrow's
			}
			ch := Channel(r.Channel)
			if byChannel[ch] == nil {
				order = append(order, ch)
			}
			byChannel[ch] = append(byChannel[ch], r)
		}
		lang := ""
		if u, err := s.rq.GetUserByID(ctx, userID); err == nil {
			lang = u.Locale
		}
		for _, ch := range order {
			e, ok := bundle(byChannel[ch], lang)
			if !ok {
				continue
			}
			if err := s.enqueue(ctx, userID, ch, e); err != nil {
				continue
			}
			queued = true
			for _, r := range byChannel[ch] {
				_ = s.q.DeleteHeldNotification(ctx, r.ID)
			}
		}
	}
	if queued {
		s.kick()
	}
}

// digestText is the digest's wording, one per language.
type digestText struct{ title string }

var digestTexts = map[string]digestText{
	"en":    {title: "Your digest: %d notifications"},
	"it":    {title: "Il tuo riepilogo: %d notifiche"},
	"de":    {title: "Deine Zusammenfassung: %d Benachrichtigungen"},
	"fr":    {title: "Votre récapitulatif : %d notifications"},
	"es":    {title: "Tu resumen: %d notificaciones"},
	"pt-BR": {title: "Seu resumo: %d notificações"},
}

// bundle is what one channel sends for its held events: the event itself if
// it is alone, else one digest listing them, oldest first.
func bundle(rows []db.NotificationHeld, lang string) (Event, bool) {
	var events []Event
	for _, r := range rows {
		var e Event
		if json.Unmarshal([]byte(r.Payload), &e) == nil {
			events = append(events, e)
		}
	}
	switch len(events) {
	case 0:
		return Event{}, false
	case 1:
		return events[0], true
	}
	lines := make([]string, 0, len(events))
	for _, e := range events {
		lines = append(lines, "• "+e.Title+": "+e.Body)
	}
	return Event{
		Kind: KindDigest, Title: fmt.Sprintf(locale.Pick(digestTexts, lang).title, len(events)),
		Body: strings.Join(lines, "\n"), URL: "/",
	}, true
}
