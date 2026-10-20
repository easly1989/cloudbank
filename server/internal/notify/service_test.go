package notify

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// fakeSender records what reached its channel and to whom; err makes every
// send fail.
type fakeSender struct {
	got []Event
	to  []Recipient
	err error
}

func (f *fakeSender) Send(_ context.Context, to Recipient, e Event) error {
	f.got = append(f.got, e)
	f.to = append(f.to, to)
	return f.err
}

type fixture struct {
	st   *store.Store
	q    *db.Queries
	svc  *Service
	push *fakeSender
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc := NewService(st.Read(), st.Write(), nil)
	push := &fakeSender{}
	svc.SetSender(ChannelPush, push)
	return fixture{st: st, q: db.New(st.Write()), svc: svc, push: push}
}

func (f fixture) user(t *testing.T, name string) db.User {
	t.Helper()
	u, err := f.q.CreateUser(context.Background(), db.CreateUserParams{Username: name, PasswordHash: "x"})
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func (f fixture) bell(t *testing.T, userID int64) ([]Notification, int64) {
	t.Helper()
	items, unread, err := f.svc.List(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	return items, unread
}

// An event nobody changed the settings of reaches the bell and every other
// channel, because the events that exist today are on by default.
func TestNotifyDefaultsReachEveryChannel(t *testing.T) {
	f := newFixture(t)
	u := f.user(t, "u")
	e := Event{Kind: KindMailStopped, Title: "Stopped", Body: "b", URL: "/settings/mail"}
	if err := f.svc.Notify(context.Background(), u.ID, e); err != nil {
		t.Fatal(err)
	}
	f.svc.deliverDue(context.Background())
	items, unread := f.bell(t, u.ID)
	if len(items) != 1 || unread != 1 || items[0].Title != "Stopped" || items[0].URL != "/settings/mail" || items[0].Read {
		t.Fatalf("bell = %+v (unread %d)", items, unread)
	}
	if len(f.push.got) != 1 || f.push.got[0].Title != "Stopped" {
		t.Fatalf("push got %+v", f.push.got)
	}
}

// Turning an event off on a channel stops it there and only there.
func TestNotifyFollowsPreferences(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	if err := f.svc.SetPreference(ctx, u.ID, KindBills, ChannelPush, false); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "Bills"}); err != nil {
		t.Fatal(err)
	}
	f.svc.deliverDue(ctx)
	if items, _ := f.bell(t, u.ID); len(items) != 1 {
		t.Fatalf("bell has %d, want 1", len(items))
	}
	if len(f.push.got) != 0 {
		t.Fatalf("push got %d, want none", len(f.push.got))
	}

	if err := f.svc.SetPreference(ctx, u.ID, KindBills, ChannelInApp, false); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "Bills again"}); err != nil {
		t.Fatal(err)
	}
	if items, _ := f.bell(t, u.ID); len(items) != 1 {
		t.Fatalf("bell has %d after turning it off, want still 1", len(items))
	}

	prefs, err := f.svc.Preferences(ctx, u.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range prefs {
		want := p.Kind != KindBills && p.Group != GroupMoney && p.Group != GroupSummaries && p.Kind != KindUnusual
		// An unusual transaction starts in the bell alone (#700).
		if p.Channels[ChannelInApp] != (want || p.Kind == KindUnusual) || p.Channels[ChannelPush] != want {
			t.Errorf("preference %s = %+v", p.Kind, p.Channels)
		}
	}
}

// A security event reaches the bell even with every channel turned off, and
// the bell cannot be turned off for it (#690).
func TestSecurityAlwaysReachesTheBell(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	for _, ch := range Channels {
		err := f.svc.SetPreference(ctx, u.ID, KindNewDevice, ch, false)
		if ch == ChannelInApp {
			if !errors.Is(err, ErrAlwaysOn) {
				t.Fatalf("turning the bell off = %v", err)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	// Even a choice stored some other way does not silence it.
	if err := f.q.SetNotificationPref(ctx, db.SetNotificationPrefParams{UserID: u.ID, Kind: string(KindNewDevice), Channel: string(ChannelInApp), Enabled: 0}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Notify(ctx, u.ID, Event{Kind: KindNewDevice, Title: "New sign-in"}); err != nil {
		t.Fatal(err)
	}
	f.svc.deliverDue(ctx)
	if items, _ := f.bell(t, u.ID); len(items) != 1 || items[0].Title != "New sign-in" {
		t.Fatalf("bell = %+v", items)
	}
	if len(f.push.got) != 0 {
		t.Fatalf("push got %+v, want nothing", f.push.got)
	}
	prefs, _ := f.svc.Preferences(ctx, u.ID, false)
	for _, p := range prefs {
		if p.Group == GroupSecurity && !p.Channels[ChannelInApp] {
			t.Errorf("%s shows the bell off", p.Kind)
		}
	}
	// Any other event can still leave the bell.
	if err := f.svc.SetPreference(ctx, u.ID, KindBankSyncFailed, ChannelInApp, false); err != nil {
		t.Fatal(err)
	}
}

// An admin event reaches the administrators whose account is on, each in
// their language, and only they see it among their choices.
func TestNotifyAdmins(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	admin := f.user(t, "admin")
	member := f.user(t, "member")
	gone := f.user(t, "gone")
	_, _ = f.st.Write().ExecContext(ctx, "UPDATE users SET is_admin = 1, locale = 'it' WHERE id IN (?, ?)", admin.ID, gone.ID)
	_ = f.q.SetUserDisabled(ctx, db.SetUserDisabledParams{Disabled: 1, ID: gone.ID})

	err := f.svc.NotifyAdmins(ctx, func(lang string) Event {
		return Event{Kind: KindNewVersion, Ref: "new-version:v9", Title: "v9 " + lang, URL: "/settings/about"}
	})
	if err != nil {
		t.Fatal(err)
	}
	if items, _ := f.bell(t, admin.ID); len(items) != 1 || items[0].Title != "v9 it" || items[0].URL != "/settings/about" {
		t.Fatalf("admin's bell = %+v", items)
	}
	for _, u := range []db.User{member, gone} {
		if items, _ := f.bell(t, u.ID); len(items) != 0 {
			t.Errorf("%s's bell = %+v", u.Username, items)
		}
	}
	has := func(admin bool) bool {
		prefs, _ := f.svc.Preferences(ctx, member.ID, admin)
		for _, p := range prefs {
			if p.Kind == KindNewVersion {
				return true
			}
		}
		return false
	}
	if has(false) || !has(true) {
		t.Fatalf("admin event among the choices: member %v, admin %v", has(false), has(true))
	}
}

// A wallet event reaches its members whose account is on, each in their
// language, marked with the wallet.
func TestNotifyWallet(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a, b, out, gone := f.user(t, "a"), f.user(t, "b"), f.user(t, "out"), f.user(t, "gone")
	_, _ = f.st.Write().ExecContext(ctx, "UPDATE users SET locale = 'de' WHERE id = ?", b.ID)
	_ = f.q.SetUserDisabled(ctx, db.SetUserDisabledParams{Disabled: 1, ID: gone.ID})
	w, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	for _, u := range []db.User{a, b, gone} {
		_ = f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "member"})
	}
	err := f.svc.NotifyWallet(ctx, w.ID, func(lang string) Event {
		return Event{Kind: KindBankSyncFailed, Title: "failed " + lang, URL: "/settings/bank-sync"}
	})
	if err != nil {
		t.Fatal(err)
	}
	for u, want := range map[int64]string{a.ID: "failed ", b.ID: "failed de"} {
		if items, _ := f.bell(t, u); len(items) != 1 || items[0].Title != want || items[0].WalletID != w.ID {
			t.Errorf("bell of %d = %+v", u, items)
		}
	}
	for _, u := range []db.User{out, gone} {
		if items, _ := f.bell(t, u.ID); len(items) != 0 {
			t.Errorf("%s's bell = %+v", u.Username, items)
		}
	}
}

// A ref makes an event once only, per person.
func TestNotifyRefOnce(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a, b := f.user(t, "a"), f.user(t, "b")
	for _, uid := range []int64{a.ID, a.ID, b.ID} {
		if err := f.svc.Notify(ctx, uid, Event{Kind: KindMailUnrecognized, Ref: "mail:1:2026-10-18", Title: "t"}); err != nil {
			t.Fatal(err)
		}
	}
	if items, _ := f.bell(t, a.ID); len(items) != 1 {
		t.Fatalf("a's bell has %d, want 1", len(items))
	}
	if items, _ := f.bell(t, b.ID); len(items) != 1 {
		t.Fatalf("b's bell has %d, want 1", len(items))
	}
	f.svc.deliverDue(ctx)
	if len(f.push.got) != 2 {
		t.Fatalf("pushes = %d, want 2", len(f.push.got))
	}
}

// A channel that fails does not lose the event in the bell.
func TestNotifyFailingSenderKeepsTheBell(t *testing.T) {
	f := newFixture(t)
	f.push.err = errors.New("410")
	u := f.user(t, "u")
	if err := f.svc.Notify(context.Background(), u.ID, Event{Kind: KindBills, Title: "t"}); err != nil {
		t.Fatalf("Notify: %v", err)
	}
	if items, _ := f.bell(t, u.ID); len(items) != 1 {
		t.Fatalf("bell has %d, want 1", len(items))
	}
}

func TestNotifyRefusesUnknownEvents(t *testing.T) {
	f := newFixture(t)
	u := f.user(t, "u")
	if err := f.svc.Notify(context.Background(), u.ID, Event{Kind: "nope"}); !errors.Is(err, ErrUnknownEvent) {
		t.Fatalf("Notify(unknown) = %v", err)
	}
	if err := f.svc.SetPreference(context.Background(), u.ID, KindBills, "pigeon", true); !errors.Is(err, ErrUnknownEvent) {
		t.Fatalf("SetPreference(unknown channel) = %v", err)
	}
}

// Read marks are per person, and a notification about a wallet the person has
// left disappears from their bell.
func TestBellReadAndWalletMembership(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a, b := f.user(t, "a"), f.user(t, "b")
	w, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	_ = f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: a.ID, Role: "owner"})

	_ = f.svc.Notify(ctx, a.ID, Event{Kind: KindBills, Title: "wallet", WalletID: w.ID})
	_ = f.svc.Notify(ctx, a.ID, Event{Kind: KindMailStopped, Title: "mine"})
	_ = f.svc.Notify(ctx, b.ID, Event{Kind: KindMailStopped, Title: "b's"})

	items, unread := f.bell(t, a.ID)
	if len(items) != 2 || unread != 2 || items[0].Title != "mine" {
		t.Fatalf("a's bell = %+v (unread %d)", items, unread)
	}
	// b cannot mark a's notification read.
	if err := f.svc.MarkRead(ctx, b.ID, items[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, unread := f.bell(t, a.ID); unread != 2 {
		t.Fatalf("unread after b's mark = %d, want 2", unread)
	}
	if err := f.svc.MarkRead(ctx, a.ID, items[0].ID); err != nil {
		t.Fatal(err)
	}
	if items, unread := f.bell(t, a.ID); unread != 1 || !items[0].Read {
		t.Fatalf("after a's mark: %+v (unread %d)", items, unread)
	}

	if _, err := f.st.Write().ExecContext(ctx, "DELETE FROM wallet_members WHERE wallet_id = ? AND user_id = ?", w.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if items, unread := f.bell(t, a.ID); len(items) != 1 || unread != 0 {
		t.Fatalf("after leaving the wallet: %+v (unread %d)", items, unread)
	}

	if err := f.svc.MarkAllRead(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, unread := f.bell(t, b.ID); unread != 0 {
		t.Fatalf("b unread after mark all = %d", unread)
	}
}

// The bell keeps 90 days.
func TestPurgeKeepsNinetyDays(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	_ = f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "now"})
	if err := f.svc.Purge(ctx, time.Now().Add(89*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if items, _ := f.bell(t, u.ID); len(items) != 1 {
		t.Fatalf("purged too early: %d left", len(items))
	}
	if err := f.svc.Purge(ctx, time.Now().Add(91*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if items, _ := f.bell(t, u.ID); len(items) != 0 {
		t.Fatalf("not purged after 90 days: %d left", len(items))
	}
}

// Every member of a wallet hears of an overdue bill once, in the bell and on
// push, whether or not they ever subscribed a browser.
func TestBillsRemindersReachEveryMemberOnce(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.svc.SetBills(bills.NewService(f.st.Read()))
	a, b := f.user(t, "a"), f.user(t, "b")
	w, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	_ = f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: a.ID, Role: "owner"})
	_ = f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: b.ID, Role: "member"})
	cur, _ := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	tpl, _ := f.q.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: w.ID, Name: "Rent", AccountID: sql.NullInt64{Int64: acc.ID, Valid: true}, Amount: -120000,
	})
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	_, _ = f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: w.ID, TemplateID: tpl.ID, Unit: "month", EveryN: 1,
		NextDue: "2026-06-14", WeekendMode: 0, Remaining: sql.NullInt64{}, PostAdvance: 0, AutoPost: 1,
	})

	for range 2 {
		if err := f.svc.RunBillsReminders(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	f.svc.deliverDue(ctx)
	for _, u := range []db.User{a, b} {
		items, _ := f.bell(t, u.ID)
		if len(items) != 1 || items[0].Body != "Rent is due or overdue" || items[0].URL != "/schedules" || items[0].WalletID != w.ID {
			t.Errorf("%s's bell = %+v", u.Username, items)
		}
	}
	if len(f.push.got) != 2 {
		t.Fatalf("pushes = %d, want 2 (one per member, once)", len(f.push.got))
	}
}

// Every language CloudBank speaks has the reminder's wording.
func TestBillsEventLanguages(t *testing.T) {
	for _, lang := range locale.Supported {
		text, ok := reminderTexts[lang]
		if !ok || text.title == "" || text.many == "" || text.one == "" {
			t.Errorf("no complete reminder wording for %q", lang)
		}
	}
	one := []bills.Bill{{Name: "Rent"}}
	if e := billsEvent(one, "it"); e.Title != "Scadenze in arrivo" || e.Body != "Rent è in scadenza o scaduta" || e.Kind != KindBills {
		t.Errorf("Italian event = %+v", e)
	}
	if e := billsEvent(append(one, bills.Bill{Name: "Gym"}), "xx"); e.Title != "Bills due" || e.Body != "2 bills need your attention" {
		t.Errorf("unknown language event = %+v", e)
	}
}
