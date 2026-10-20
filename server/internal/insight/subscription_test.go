package insight

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// The rows of a subscription proposal are CloudBank's: the last two payments
// over the amount saved, a second schedule to the same payee or of the same
// amount just as often, and a schedule registered by hand not paid for two of
// its periods. A schedule that posts itself, one paid as saved, a raise inside
// one period and a payment far off the amount are not proposed.
func TestSubscriptionProposalRows(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "anna", PasswordHash: "x", Locale: "it"})
	_, _ = st.Write().ExecContext(ctx, "UPDATE users SET is_admin = 1 WHERE id = ?", u.ID)
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Casa"})
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "owner"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "Conto", Type: "checking", CurrencyID: cur.ID, Position: 1})
	txns := transaction.NewService(st.Write())
	payee := func(name string) int64 {
		t.Helper()
		p, err := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: w.ID, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	sched := func(name string, payee, amount, everyN int64, auto bool) int64 {
		t.Helper()
		tpl, err := q.InsertTemplate(ctx, db.InsertTemplateParams{
			WalletID: w.ID, Name: name, AccountID: sql.NullInt64{Int64: acc.ID, Valid: true}, Amount: amount,
			PayeeID: sql.NullInt64{Int64: payee, Valid: true}, Tags: "[]",
		})
		if err != nil {
			t.Fatal(err)
		}
		a := int64(0)
		if auto {
			a = 1
		}
		sc, err := q.InsertSchedule(ctx, db.InsertScheduleParams{
			WalletID: w.ID, TemplateID: tpl.ID, Unit: schedule.UnitMonth, EveryN: everyN, NextDue: "2027-02-01", AutoPost: a,
		})
		if err != nil {
			t.Fatal(err)
		}
		return sc.ID
	}
	pay := func(payee int64, date string, amount int64) {
		t.Helper()
		if _, err := txns.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: date, Amount: amount, PayeeID: &payee}); err != nil {
			t.Fatal(err)
		}
	}

	streaming, gym, water, phone, cloud, rent := payee("Streaming"), payee("Gym"), payee("Water"), payee("Phone"), payee("Cloud"), payee("Rent")
	sStreaming := sched("Streaming", streaming, -1299, 1, false)
	sStreaming2 := sched("Streaming 2", streaming, -1299, 1, false)
	sGym := sched("Gym", gym, -3900, 1, false)
	sWater := sched("Water", water, -6000, 3, false)
	sched("Phone", phone, -2000, 1, false)
	sCloud := sched("Cloud", cloud, -2000, 1, false)
	sched("Rent", rent, -75000, 1, true)
	sched("Water heater", water, 0, 12, false) // nothing to pay: not a subscription

	for m := 7; m <= 12; m++ {
		d := func(dd int) string { return time.Date(2026, time.Month(m), dd, 0, 0, 0, 0, time.UTC).Format(day) }
		if m <= 10 {
			pay(streaming, d(5), -1299)
			pay(gym, d(3), -3900)
		} else {
			pay(streaming, d(5), -1599)
		}
		pay(phone, d(8), -2000)
		pay(cloud, d(9), -2000)
		if m <= 9 {
			pay(rent, d(1), -75000) // posts itself: never "not paid"
		}
	}
	// Phone's raise came twice in one month: one period, not two.
	pay(phone, "2026-12-20", -2200)
	pay(phone, "2026-12-28", -2200)
	pay(gym, "2026-12-20", -50000) // a one-off far off the amount saved
	pay(water, "2026-04-20", -6000)
	pay(water, "2026-07-20", -6300)
	pay(water, "2026-10-20", -6350)

	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		asked = append(asked, string(b))
		mu.Unlock()
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"Lo streaming costa di più."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	if _, err := aisvc.UpdateSettings(ctx, u.ID, true, ai.SettingsInput{
		Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key, Features: &ai.Features{Subscriptions: true},
	}); err != nil {
		t.Fatal(err)
	}
	n := notify.NewService(st.Read(), st.Write(), nil)
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	clock := time.Date(2027, 1, 15, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }

	basis, err := svc.subscriptionRows(ctx, w.ID, clock)
	if err != nil {
		t.Fatal(err)
	}
	type got struct {
		id       int64
		reason   string
		amount   int64
		proposed int64
		other    string
		last     string
		yearly   int64
	}
	var rows []got
	for _, r := range basis.Rows {
		rows = append(rows, got{r.ScheduleID, r.Reason, r.Amount, r.Proposed, r.Other, r.Last, r.Yearly})
	}
	want := []got{
		{sWater, reasonRaised, 6000, 6350, "", "2026-10-20", 24000},
		{sStreaming, reasonRaised, 1299, 1599, "", "2026-12-05", 15588},
		{sCloud, reasonAlike, 2000, 0, "Phone", "", 24000},
		{sStreaming2, reasonDouble, 1299, 0, "Streaming", "", 15588},
		{sGym, reasonUnused, 3900, 0, "", "2026-10-03", 46800},
	}
	if len(rows) != len(want) {
		t.Fatalf("rows = %+v", rows)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, rows[i], want[i])
		}
	}
	if p := basis.Rows[0].Paid; len(p) != 2 || p[0] != 6300 || p[1] != 6350 {
		t.Fatalf("paid = %v", p)
	}

	// The scheduler: one proposal, one note pointing at Schedules.
	for range 2 {
		if err := svc.RunScheduled(ctx); err != nil {
			t.Fatal(err)
		}
	}
	props, err := svc.Proposals(ctx, u.ID, w.ID)
	if err != nil || len(props) != 1 || props[0].Kind != KindSubscriptions || len(props[0].Basis.Rows) != 5 {
		t.Fatalf("proposals = %+v %v", props, err)
	}
	if len(asked) != 1 ||
		!strings.Contains(asked[0], "Streaming: saved at 12.99 EUR, the last 2 payments were 15.99 EUR and 15.99 EUR; 36.00 EUR a year more than saved") ||
		!strings.Contains(asked[0], "Streaming 2: looks like a double of Streaming, paying the same payee") ||
		!strings.Contains(asked[0], "Cloud: may be a double of Phone, the same amount just as often") ||
		!strings.Contains(asked[0], "Gym: no payment found in the bank since 2026-10-03; 468.00 EUR a year") {
		t.Fatalf("the model was asked %v", asked)
	}
	items, _, _ := n.List(ctx, u.ID)
	if len(items) != 1 || items[0].Kind != notify.KindAIProposal || items[0].Title != "Abbonamenti da guardare" ||
		items[0].Body != "Casa: li trovi in Programmate." || items[0].URL != "/schedules?view=list" {
		t.Fatalf("bell = %+v", items)
	}

	// Applied by schedule: the row goes, the others stay.
	if err := svc.Act(ctx, u.ID, w.ID, props[0].ID, ActionApplied, sGym); err != nil {
		t.Fatal(err)
	}
	if err := svc.Act(ctx, u.ID, w.ID, props[0].ID, ActionApplied, 999999); err != ErrBadAction {
		t.Fatalf("a schedule not in the proposal = %v", err)
	}
	props, _ = svc.Proposals(ctx, u.ID, w.ID)
	if len(props) != 1 || len(props[0].Basis.Rows) != 4 {
		t.Fatalf("after applying = %+v", props)
	}
}

// Every kind of proposal tells the model it gives no investment advice, and
// has its notification in every language.
func TestProposalKinds(t *testing.T) {
	for kind, k := range proposalKinds {
		if !strings.Contains(k.system, "Give no investment advice.") {
			t.Errorf("%s: the system prompt allows investment advice", kind)
		}
		for l := range reportNotes {
			if _, ok := k.notes[l]; !ok {
				t.Errorf("%s: no wording for %s", kind, l)
			}
		}
	}
}
