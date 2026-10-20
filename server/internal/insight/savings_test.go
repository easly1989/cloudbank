package insight

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
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

// The rows of a savings proposal are CloudBank's: a category whose last three
// months are at least a fifth and 10 a month over the nine before, back to
// the earlier level rounded to 5; at most three, the most kept first. Steady
// spending, a small rise, a rise of a few cents and a category the budget
// proposal already has are not proposed.
func TestSavingsProposalRows(t *testing.T) {
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
	cat := func(name string, parent int64) int64 {
		t.Helper()
		c, err := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, ParentID: sql.NullInt64{Int64: parent, Valid: parent != 0}, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	food := cat("Food", 0)
	restaurants := cat("Restaurants", food)
	fuel, clothing, games, coffee, rent, books, gym := cat("Fuel", 0), cat("Clothing", 0), cat("Games", 0), cat("Coffee", 0), cat("Rent", 0), cat("Books", 0), cat("Gym", 0)
	txns := transaction.NewService(st.Write())
	// Each category: what it took a month in the nine months before, then in
	// the last three, 2026-01 to 2026-12.
	for c, v := range map[int64][2]int64{
		restaurants: {-12000, -26000}, fuel: {-10000, -13000}, clothing: {-4000, -5200}, games: {-2000, -4000},
		coffee: {-1000, -1500}, rent: {-75000, -75000}, books: {-5000, -5800}, gym: {-3000, -6000},
	} {
		for m := 1; m <= 12; m++ {
			amount := v[0]
			if m > 9 {
				amount = v[1]
			}
			date := time.Date(2026, time.Month(m), 10, 0, 0, 0, 0, time.UTC).Format(day)
			if _, err := txns.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: date, Amount: amount, CategoryID: &c}); err != nil {
				t.Fatal(err)
			}
		}
	}

	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		asked = append(asked, string(b))
		mu.Unlock()
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"I ristoranti sono raddoppiati."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	if _, err := aisvc.UpdateSettings(ctx, u.ID, true, ai.SettingsInput{
		Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key, Features: &ai.Features{Savings: true},
	}); err != nil {
		t.Fatal(err)
	}
	n := notify.NewService(st.Read(), st.Write(), nil)
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	clock := time.Date(2027, 1, 15, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }

	// The gym is in the budget proposal waiting on the wallet.
	if _, err := q.InsertAIProposal(ctx, db.InsertAIProposalParams{
		UserID: u.ID, WalletID: w.ID, Kind: KindBudget, Period: "2027-01", Body: "b", Model: "m",
		Basis: `{"months":[],"currency":{},"rows":[{"categoryId":` + strconv.FormatInt(gym, 10) + `}]}`,
	}); err != nil {
		t.Fatal(err)
	}

	basis, err := svc.savingsRows(ctx, u.ID, w.ID, clock)
	if err != nil {
		t.Fatal(err)
	}
	type got struct {
		id                       int64
		before, recent, proposed int64
	}
	var rows []got
	for _, r := range basis.Rows {
		if r.Reason != reasonGrown {
			t.Fatalf("reason = %q", r.Reason)
		}
		rows = append(rows, got{r.CategoryID, r.Before, r.Recent, r.Proposed})
	}
	want := []got{{restaurants, 12000, 26000, 12000}, {fuel, 10000, 13000, 10000}, {games, 2000, 4000, 2000}}
	if len(rows) != len(want) {
		t.Fatalf("rows = %+v", rows)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, rows[i], want[i])
		}
	}
	if basis.Rows[0].Name != "Food:Restaurants" || len(basis.Months) != 12 || basis.Months[0] != "2026-01" {
		t.Fatalf("basis = %+v", basis)
	}

	// The scheduler: one proposal, one note pointing at AI insights.
	for range 2 {
		if err := svc.RunScheduled(ctx); err != nil {
			t.Fatal(err)
		}
	}
	props, err := svc.Proposals(ctx, u.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	var saved *Proposal
	for i := range props {
		if props[i].Kind == KindSavings {
			saved = &props[i]
		}
	}
	if saved == nil || len(saved.Basis.Rows) != 3 || saved.Body != "I ristoranti sono raddoppiati." {
		t.Fatalf("proposals = %+v", props)
	}
	if len(asked) != 1 ||
		!strings.Contains(asked[0], "the last 3 months, 2026-10 to 2026-12, against the 9 before") ||
		!strings.Contains(asked[0], "Food:Restaurants: 260.00 EUR a month lately against 120.00 EUR before (+116%); back to 120.00 EUR keeps 140.00 EUR a month") ||
		!strings.Contains(asked[0], "In all: 190.00 EUR a month.") {
		t.Fatalf("the model was asked %v", asked)
	}
	items, _, _ := n.List(ctx, u.ID)
	if len(items) != 1 || items[0].Title != "Risparmi da guardare" || items[0].URL != "/insights" {
		t.Fatalf("bell = %+v", items)
	}
}
