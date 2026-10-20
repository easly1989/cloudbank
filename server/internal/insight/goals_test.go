package insight

import (
	"context"
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
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// The rows of a goal proposal are the Goals page's arithmetic: a dated goal
// behind its share is told to put the share aside, or to move its date when
// the share is more than the wallet kept a month; a goal with no date is told
// when its pace gets there. A goal on track, one reached and one with nothing
// put in lately are not proposed.
func TestGoalProposalRows(t *testing.T) {
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
	// 500 kept a month in October, November and December.
	for m := 10; m <= 12; m++ {
		for _, a := range []int64{200000, -150000} {
			date := time.Date(2026, time.Month(m), 5, 0, 0, 0, 0, time.UTC).Format(day)
			if _, err := txns.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: date, Amount: a}); err != nil {
				t.Fatal(err)
			}
		}
	}
	goals := goal.NewServiceWithRead(st.Read(), st.Write())
	add := func(name string, target int64, date string, moves map[string]int64) int64 {
		t.Helper()
		in := goal.Input{Name: name, TargetAmount: target}
		if date != "" {
			in.TargetDate = &date
		}
		g, err := goals.Create(ctx, w.ID, in)
		if err != nil {
			t.Fatal(err)
		}
		for d, a := range moves {
			if _, err := goals.AddContribution(ctx, w.ID, g.ID, d, a, ""); err != nil {
				t.Fatal(err)
			}
		}
		return g.ID
	}
	lately := func(a, b, c int64) map[string]int64 {
		return map[string]int64{"2026-10-10": a, "2026-11-10": b, "2026-12-10": c}
	}
	trip := add("Trip", 180000, "2027-06-30", map[string]int64{"2026-06-10": 20000, "2026-10-10": 10000, "2026-11-10": 10000, "2026-12-10": 10000})
	car := add("Car", 2000000, "2027-12-31", lately(30000, 30000, 40000))
	fund := add("Fund", 500000, "", lately(10000, 10000, 10000))
	add("Lazy", 500000, "", map[string]int64{"2026-01-10": 10000})
	add("On track", 40000, "2027-03-31", lately(10000, 10000, 10000))
	add("Reached", 30000, "2027-03-31", lately(10000, 10000, 10000))

	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		asked = append(asked, string(b))
		mu.Unlock()
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"Il viaggio è indietro."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	if _, err := aisvc.UpdateSettings(ctx, u.ID, true, ai.SettingsInput{
		Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key, Features: &ai.Features{Goals: true},
	}); err != nil {
		t.Fatal(err)
	}
	n := notify.NewService(st.Read(), st.Write(), nil)
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	svc.SetGoals(goals)
	clock := time.Date(2027, 1, 15, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }

	basis, err := svc.goalRows(ctx, w.ID, clock)
	if err != nil {
		t.Fatal(err)
	}
	type got struct {
		id                   int64
		reason               string
		left, pace, proposed int64
		date, newDate        string
	}
	var rows []got
	for _, r := range basis.Rows {
		rows = append(rows, got{r.GoalID, r.Reason, r.Left, r.Pace, r.Proposed, r.Date, r.NewDate})
	}
	want := []got{
		{trip, reasonLate, 130000, 10000, 26000, "2027-06-30", "2028-02-29"},
		{car, reasonMove, 1900000, 33300, 172800, "2027-12-31", "2031-11-30"},
		{fund, reasonETA, 470000, 10000, 10000, "", "2030-12-31"},
	}
	if len(rows) != len(want) {
		t.Fatalf("rows = %+v", rows)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, rows[i], want[i])
		}
	}
	if basis.Kept != 50000 {
		t.Fatalf("kept = %d", basis.Kept)
	}

	// The scheduler: one proposal, one note pointing at Goals.
	for range 2 {
		if err := svc.RunScheduled(ctx); err != nil {
			t.Fatal(err)
		}
	}
	props, err := svc.Proposals(ctx, u.ID, w.ID)
	if err != nil || len(props) != 1 || props[0].Kind != KindGoals || len(props[0].Basis.Rows) != 3 {
		t.Fatalf("proposals = %+v %v", props, err)
	}
	if len(asked) != 1 ||
		!strings.Contains(asked[0], "Give no investment advice. Never say where to keep or invest the money.") ||
		!strings.Contains(asked[0], "in them the wallet kept 500.00 EUR a month") ||
		!strings.Contains(asked[0], "Trip: 1300.00 EUR left by 2027-06, needs 260.00 EUR a month, goes in at 100.00 EUR a month, which gets there in 2028-02; proposed: put aside 260.00 EUR a month") ||
		!strings.Contains(asked[0], "Car: 19000.00 EUR left by 2027-12, needs 1728.00 EUR a month, more than the wallet keeps") ||
		!strings.Contains(asked[0], "Fund: no date, 4700.00 EUR left, goes in at 100.00 EUR a month; proposed: set the date to 2030-12") {
		t.Fatalf("the model was asked %v", asked)
	}
	items, _, _ := n.List(ctx, u.ID)
	if len(items) != 1 || items[0].Title != "Obiettivi da guardare" || items[0].URL != "/goals" {
		t.Fatalf("bell = %+v", items)
	}
	if err := svc.Act(ctx, u.ID, w.ID, props[0].ID, ActionApplied, trip); err != nil {
		t.Fatal(err)
	}
}
