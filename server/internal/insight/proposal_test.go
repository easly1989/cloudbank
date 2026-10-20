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

// The rows of a budget proposal are CloudBank's: a category spent on most
// months without a budget, a budget gone over or not reached most months,
// and nothing for a budget near enough, a seldom spending or income. The
// scheduler makes one a month, says so in the bell, and writes no report
// when only proposals are on.
func TestBudgetProposalRows(t *testing.T) {
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
	cat := func(name string, parent int64, income bool) int64 {
		t.Helper()
		in := int64(0)
		if income {
			in = 1
		}
		c, err := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, ParentID: sql.NullInt64{Int64: parent, Valid: parent != 0}, Name: name, IsIncome: in})
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	food := cat("Food", 0, false)
	groceries := cat("Groceries", food, false)
	fuel, books, coffee, rent := cat("Fuel", 0, false), cat("Books", 0, false), cat("Coffee", 0, false), cat("Rent", 0, false)
	salary := cat("Salary", 0, true)
	// A parent spent on itself, with no budget: its budget would cover Bills too.
	home := cat("Home", 0, false)
	bills := cat("Bills", home, false)
	budgets := budget.NewServiceWithRead(st.Read(), st.Write())
	for id, v := range map[int64]int64{food: -30000, fuel: -10000, books: -5000} {
		if err := budgets.SetCategoryBudget(ctx, w.ID, id, 0, budget.Input{Mode: budget.ModeSame, Same: v}); err != nil {
			t.Fatal(err)
		}
	}
	txns := transaction.NewService(st.Write())
	add := func(c int64, month int, amount int64) {
		t.Helper()
		date := time.Date(2026, time.Month(month), 10, 0, 0, 0, 0, time.UTC).Format(day)
		if _, err := txns.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: date, Amount: amount, CategoryID: &c}); err != nil {
			t.Fatal(err)
		}
	}
	for m := 7; m <= 12; m++ {
		add(groceries, m, -25000)
		add(books, m, -4800)
		add(rent, m, -75000)
		add(salary, m, 250000)
		add(home, m, -3000)
		add(bills, m, -6000)
		if m == 9 {
			add(fuel, m, -9000)
		} else {
			add(fuel, m, -15000)
		}
		if m <= 10 {
			add(coffee, m, -300)
		}
	}

	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		asked = append(asked, string(b))
		mu.Unlock()
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"L'affitto torna ogni mese."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	if _, err := aisvc.UpdateSettings(ctx, u.ID, true, ai.SettingsInput{
		Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key, Features: &ai.Features{Budgets: true},
	}); err != nil {
		t.Fatal(err)
	}
	n := notify.NewService(st.Read(), st.Write(), nil)
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budgets,
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	clock := time.Date(2027, 1, 15, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }

	basis, err := svc.budgetRows(ctx, w.ID, clock)
	if err != nil {
		t.Fatal(err)
	}
	type got struct {
		id               int64
		reason           string
		budget, proposed int64
		hits             int
	}
	var rows []got
	for _, r := range basis.Rows {
		rows = append(rows, got{r.CategoryID, r.Reason, r.Budget, r.Proposed, r.Hits})
	}
	want := []got{{rent, reasonNone, 0, 75000, 6}, {bills, reasonNone, 0, 6000, 6}, {food, reasonUnder, 30000, 25000, 6}, {fuel, reasonOver, 10000, 15000, 5}}
	if len(rows) != len(want) {
		t.Fatalf("rows = %+v", rows)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, rows[i], want[i])
		}
	}
	if basis.Months[0] != "2026-07" || basis.Months[5] != "2026-12" || basis.Rows[0].Name != "Rent" {
		t.Fatalf("basis = %+v", basis)
	}

	// The scheduler: one proposal, one note, no report; again, nothing more.
	for range 2 {
		if err := svc.RunScheduled(ctx); err != nil {
			t.Fatal(err)
		}
	}
	props, err := svc.Proposals(ctx, u.ID, w.ID)
	if err != nil || len(props) != 1 || props[0].Body != "L'affitto torna ogni mese." || props[0].Period != "2027-01" {
		t.Fatalf("proposals = %+v %v", props, err)
	}
	if len(asked) != 1 || !strings.Contains(asked[0], "Rent: no budget, spent on in 6 of 6 months") || !strings.Contains(asked[0], "in Italian") {
		t.Fatalf("the model was asked %v", asked)
	}
	if reps, _ := svc.List(ctx, u.ID, w.ID); len(reps) != 0 {
		t.Fatalf("a report was written with reports off: %+v", reps)
	}
	items, _, _ := n.List(ctx, u.ID)
	if len(items) != 1 || items[0].Kind != notify.KindAIProposal || items[0].Title != "Proposta di budget pronta" ||
		items[0].Body != "Casa: la trovi in Budget." || items[0].URL != "/budget" || items[0].WalletID != w.ID {
		t.Fatalf("bell = %+v", items)
	}
}
