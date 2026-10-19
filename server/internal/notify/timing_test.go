package notify

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// On a fixed clock in the person's zone: quiet hours hold what is not urgent
// until they end, problems and security go at once, an event collected in the
// digest waits for the digest time, several go as one digest in the person's
// language, and nothing held sends nothing. The bell has everything at once.
func TestDigestAndQuietHours(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u, err := f.q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x", Locale: "it"})
	if err != nil {
		t.Fatal(err)
	}
	rome, _ := time.LoadLocation("Europe/Rome")
	at := func(day, h, m int) {
		f.svc.now = func() time.Time { return time.Date(2026, 10, day, h, m, 0, 0, rome) }
	}
	st := defaultSettings
	st.Timezone, st.QuietHours = "Europe/Rome", true
	if err := f.svc.SetSettings(ctx, u.ID, st); err != nil {
		t.Fatal(err)
	}
	_ = f.svc.SetPreference(ctx, u.ID, KindBudget, ChannelPush, true)
	_ = f.svc.SetPreference(ctx, u.ID, KindBudget, ChannelInApp, true)
	if err := f.svc.SetDigest(ctx, u.ID, KindBudget, true); err != nil {
		t.Fatal(err)
	}
	run := func() []string {
		f.push.got = nil
		f.svc.releaseHeld(ctx)
		f.svc.deliverDue(ctx)
		var titles []string
		for _, e := range f.push.got {
			titles = append(titles, e.Title)
		}
		return titles
	}
	notify := func(k Kind, title string) {
		t.Helper()
		if err := f.svc.Notify(ctx, u.ID, Event{Kind: k, Title: title, Body: title + " body"}); err != nil {
			t.Fatal(err)
		}
	}

	at(20, 6, 0) // quiet until 07:00
	notify(KindBills, "Bills")
	notify(KindBankSyncFailed, "Sync failed")
	notify(KindNewDevice, "New device")
	at(20, 6, 30)
	notify(KindBudget, "Budget")
	if got := run(); len(got) != 2 || got[0] != "Sync failed" || got[1] != "New device" {
		t.Fatalf("during quiet hours push got %v", got)
	}
	if items, _ := f.bell(t, u.ID); len(items) != 4 {
		t.Fatalf("the bell waited: %+v", items)
	}
	at(20, 7, 0)
	if got := run(); len(got) != 1 || got[0] != "Bills" {
		t.Fatalf("at the end of quiet hours push got %v", got)
	}
	at(20, 7, 59)
	if got := run(); len(got) != 0 {
		t.Fatalf("before the digest push got %v", got)
	}
	at(20, 8, 0)
	if got := run(); len(got) != 1 || got[0] != "Budget" {
		t.Fatalf("a digest of one is the event itself, got %v", got)
	}

	at(20, 9, 0)
	notify(KindBudget, "Budget A")
	notify(KindBudget, "Budget B")
	at(20, 23, 0)
	if got := run(); len(got) != 0 {
		t.Fatalf("after today's digest push got %v", got)
	}
	at(21, 8, 0)
	got := run()
	if len(got) != 1 || got[0] != "Il tuo riepilogo: 2 notifiche" {
		t.Fatalf("digest = %v", got)
	}
	if body := f.push.got[0].Body; body != "• Budget A: Budget A body\n• Budget B: Budget B body" || f.push.got[0].Kind != KindDigest {
		t.Fatalf("digest body = %q", body)
	}
	at(22, 8, 0)
	if got := run(); len(got) != 0 {
		t.Fatalf("an empty digest was sent: %v", got)
	}

	// Security never waits, and a summary is a digest already.
	if err := f.svc.SetDigest(ctx, u.ID, KindNewDevice, true); !errors.Is(err, ErrAlwaysImmediate) {
		t.Fatalf("security in the digest = %v", err)
	}
	if err := f.svc.SetDigest(ctx, u.ID, KindSummaryWeekly, true); !errors.Is(err, ErrAlwaysImmediate) {
		t.Fatalf("a summary in the digest = %v", err)
	}
	prefs, _ := f.svc.Preferences(ctx, u.ID, false)
	for _, p := range prefs {
		if p.Digest != (p.Kind == KindBudget) {
			t.Errorf("%s digest = %v", p.Kind, p.Digest)
		}
	}
}

func TestSettings(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	if st, err := f.svc.GetSettings(ctx, u.ID); err != nil || st != defaultSettings {
		t.Fatalf("defaults = %+v, %v", st, err)
	}
	for _, bad := range []func(*Settings){
		func(s *Settings) { s.Timezone = "Mars/Olympus" },
		func(s *Settings) { s.DigestAt = "8:00" },
		func(s *Settings) { s.QuietTo = "24:00" },
		func(s *Settings) { s.ReviewDays = 2 },
	} {
		st := defaultSettings
		bad(&st)
		if err := f.svc.SetSettings(ctx, u.ID, st); !errors.Is(err, ErrBadSettings) {
			t.Errorf("%+v saved: %v", st, err)
		}
	}
	want := Settings{AmountsOutside: false, Timezone: "America/New_York", DigestAt: "18:30", QuietHours: true, QuietFrom: "23:00", QuietTo: "06:30", ReviewDays: 7}
	if err := f.svc.SetSettings(ctx, u.ID, want); err != nil {
		t.Fatal(err)
	}
	if st, _ := f.svc.GetSettings(ctx, u.ID); st != want {
		t.Fatalf("saved %+v, read %+v", want, st)
	}
}

func TestQuietAndLastDigest(t *testing.T) {
	rome, _ := time.LoadLocation("Europe/Rome")
	st := Settings{Timezone: "Europe/Rome", DigestAt: "08:00", QuietHours: true, QuietFrom: "22:00", QuietTo: "07:00"}
	for _, c := range []struct {
		h, m  int
		quiet bool
	}{{21, 59, false}, {22, 0, true}, {3, 0, true}, {6, 59, true}, {7, 0, false}} {
		if got := st.Quiet(time.Date(2026, 10, 20, c.h, c.m, 0, 0, rome)); got != c.quiet {
			t.Errorf("%02d:%02d quiet = %v", c.h, c.m, got)
		}
	}
	day := Settings{Timezone: "UTC", QuietHours: true, QuietFrom: "13:00", QuietTo: "14:00"}
	if !day.Quiet(time.Date(2026, 10, 20, 13, 30, 0, 0, time.UTC)) || day.Quiet(time.Date(2026, 10, 20, 14, 0, 0, 0, time.UTC)) {
		t.Error("a span within one day")
	}
	if got := st.LastDigest(time.Date(2026, 10, 20, 7, 0, 0, 0, rome)); !got.Equal(time.Date(2026, 10, 19, 8, 0, 0, 0, rome)) {
		t.Errorf("before 08:00 the last digest is yesterday's, got %v", got)
	}
	// The night the clocks go back: still 08:00 local.
	if got := st.LastDigest(time.Date(2026, 10, 25, 9, 0, 0, 0, rome)); !got.Equal(time.Date(2026, 10, 25, 8, 0, 0, 0, rome)) {
		t.Errorf("after the change, got %v", got)
	}
}

func TestDigestLanguages(t *testing.T) {
	for _, code := range locale.Supported {
		if _, ok := digestTexts[code]; !ok {
			t.Errorf("no digest text for %q", code)
		}
	}
}
