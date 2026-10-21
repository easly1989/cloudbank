package insight

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// scripted answers each call with the next reply and keeps what it was told.
type scripted struct {
	replies []string
	told    []ai.Call
}

func (s *scripted) Ask(_ context.Context, c ai.Call) (ai.Answer, error) {
	s.told = append(s.told, c)
	r := s.replies[0]
	s.replies = s.replies[1:]
	return ai.Answer{Text: r, Model: "m"}, nil
}

// dump is every row of every table, to tell that nothing was written.
func dump(t *testing.T, conn *sql.DB) string {
	t.Helper()
	tables, err := conn.Query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for tables.Next() {
		var n string
		_ = tables.Scan(&n)
		names = append(names, n)
	}
	_ = tables.Close()
	var w strings.Builder
	for _, n := range names {
		rows, err := conn.Query(`SELECT * FROM "` + n + `"`)
		if err != nil {
			t.Fatal(err)
		}
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			_ = rows.Scan(ptrs...)
			fmt.Fprintln(&w, n, vals)
		}
		_ = rows.Close()
	}
	return w.String()
}

// A question runs the queries the model picked, on the asking wallet alone,
// drops a pick naming what the wallet does not have, and writes nothing. The
// model hears names and results, never a memo or another wallet's names.
func TestAsk(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "anna", PasswordHash: "x", Locale: "it"})
	txns := transaction.NewService(st.Write())
	type wallet struct{ id, acc, food, restaurants int64 }
	makeWallet := func(title, payee string) (wallet, int64) {
		w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: title})
		_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "owner"})
		cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
			WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
		})
		acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "Conto", Type: "checking", CurrencyID: cur.ID, Position: 1, InitialBalance: 10000})
		food, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Food"})
		rest, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Restaurants", ParentID: sql.NullInt64{Int64: food.ID, Valid: true}})
		p, _ := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: w.ID, Name: payee})
		return wallet{w.ID, acc.ID, food.ID, rest.ID}, p.ID
	}
	mine, pizzeria := makeWallet("Casa", "Pizzeria")
	other, secret := makeWallet("Altro", "Secret Shop")
	add := func(w wallet, payee, cat int64, date string, amount int64) {
		t.Helper()
		in := transaction.Input{AccountID: w.acc, Date: date, Amount: amount, PayeeID: &payee, Memo: "a private note"}
		if cat != 0 {
			in.CategoryID = &cat
		}
		if _, err := txns.Create(ctx, w.id, in); err != nil {
			t.Fatal(err)
		}
	}
	add(mine, pizzeria, mine.restaurants, "2026-06-10", -2000)
	add(mine, pizzeria, mine.restaurants, "2026-07-05", -3000)
	add(mine, pizzeria, mine.restaurants, "2026-09-01", -1000)
	add(mine, pizzeria, 0, "2026-06-27", 100000)
	add(other, secret, other.restaurants, "2026-07-01", -99999)

	model := &scripted{replies: []string{
		"Here you go:\n```json\n" + `{"tools":[` +
			`{"tool":"total","from":"2026-06-01","to":"2026-08-31","category":"restaurants","type":"expense"},` +
			`{"tool":"total","from":"2026-06-01","to":"2026-08-31","category":"Nope"},` +
			`{"tool":"by_month","from":"2026-06-01","to":"2026-08-31","category":"Food:Restaurants","type":"expense"},` +
			`{"tool":"balances"},` +
			`{"tool":"largest","from":"2026-01-01","to":"2026-12-31"}]}` + "\n```",
		"Hai speso 50,00 € al ristorante quest'estate.",
	}}
	svc := NewService(st.Read(), st.Write(), model, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.now = func() time.Time { return time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC) }

	before := dump(t, st.Read())
	got, err := svc.Ask(ctx, u.ID, mine.id, "  Quanto ho speso   al ristorante quest'estate? ", false)
	if err != nil {
		t.Fatal(err)
	}
	if after := dump(t, st.Read()); after != before {
		t.Fatal("asking wrote to the database")
	}
	if got.Answer != "Hai speso 50,00 € al ristorante quest'estate." || got.Currency.Code != "EUR" {
		t.Fatalf("answer = %+v", got)
	}
	// The unknown category is dropped; three queries at most.
	if len(got.Used) != 3 {
		t.Fatalf("used = %+v", got.Used)
	}
	total, months, balances := got.Used[0], got.Used[1], got.Used[2]
	if total.Tool != ToolTotal || total.Category != "Food:Restaurants" || total.Type != "expense" || total.Total != -5000 || total.Count != 2 {
		t.Fatalf("total = %+v", total)
	}
	if months.Tool != ToolByMonth || len(months.Items) != 2 || months.Items[0] != (AskItem{Label: "2026-06", Amount: -2000}) ||
		months.Items[1] != (AskItem{Label: "2026-07", Amount: -3000}) {
		t.Fatalf("by month = %+v", months)
	}
	if balances.Tool != ToolBalances || balances.Date != "2026-10-21" || balances.Total != 10000-6000+100000 || len(balances.Items) != 1 {
		t.Fatalf("balances = %+v", balances)
	}

	if len(model.told) != 2 {
		t.Fatalf("calls = %d", len(model.told))
	}
	pick, answer := model.told[0], model.told[1]
	if pick.Feature != ai.FeatureAsk || pick.WalletID != mine.id ||
		!strings.Contains(pick.User, "Question: Quanto ho speso al ristorante quest'estate?\nToday: 2026-10-21\n") ||
		!strings.Contains(pick.User, "Categories: Food, Food:Restaurants\n") || !strings.Contains(pick.User, "Payees: Pizzeria\n") ||
		strings.Contains(pick.User, "Secret") || strings.Contains(pick.User, "private") {
		t.Fatalf("the first call was told %q", pick.User)
	}
	if !strings.Contains(answer.User, "1. total, category Food:Restaurants, expenses only, 2026-06-01 to 2026-08-31: -50.00 EUR over 2 transactions\n") ||
		!strings.Contains(answer.User, "2026-06 -20.00 EUR; 2026-07 -30.00 EUR (total -50.00 EUR)") ||
		!strings.Contains(answer.User, "Answer in Italian.") ||
		strings.Contains(answer.User, "999.99") || strings.Contains(answer.User, "private") {
		t.Fatalf("the second call was told %q", answer.User)
	}

	// No query fits: no second call, an empty answer.
	model.replies = []string{`{"tools":[]}`}
	got, err = svc.Ask(ctx, u.ID, mine.id, "Che tempo fa?", false)
	if err != nil || got.Answer != "" || len(got.Used) != 0 || len(model.told) != 3 {
		t.Fatalf("no tools = %+v %v (%d calls)", got, err, len(model.told))
	}
	// A question too long, or empty, asks nothing.
	for _, bad := range []string{"   ", strings.Repeat("a", 301)} {
		if _, err := svc.Ask(ctx, u.ID, mine.id, bad, false); err != ErrBadQuestion {
			t.Fatalf("%q: err = %v", bad, err)
		}
	}
	if len(model.told) != 3 {
		t.Fatalf("a bad question reached the model")
	}
}
