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
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// A payee is proposed a rule when at least three of its transactions of the
// last twelve months, among those no rule decides, have a category and four
// in five of them the same one. The model hears the payees, the categories
// and the counts, never an amount or a memo.
func TestRuleProposalRows(t *testing.T) {
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
		p := db.InsertCategoryParams{WalletID: w.ID, Name: name}
		if parent != 0 {
			p.ParentID.Int64, p.ParentID.Valid = parent, true
		}
		c, err := q.InsertCategory(ctx, p)
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	food := cat("Cibo", 0)
	bar, sport, books := cat("Bar", food), cat("Sport", 0), cat("Libri", 0)
	payee := func(name string) int64 {
		p, err := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: w.ID, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	cafe, gym, shop, odd, ruled, old := payee("Caffè"), payee("Palestra"), payee("Libreria"), payee("Bazar"), payee("Super"), payee("Vecchio")
	txns := transaction.NewService(st.Write())
	add := func(p int64, cat int64, dates ...string) {
		t.Helper()
		for _, d := range dates {
			in := transaction.Input{AccountID: acc.ID, Date: d, Amount: -1234, PayeeID: &p, Memo: "segreto"}
			if cat != 0 {
				in.CategoryID = &cat
			}
			if _, err := txns.Create(ctx, w.ID, in); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Caffè: 4 of 5 filed under Bar, 2 without: proposed, first.
	add(cafe, bar, "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01")
	add(cafe, sport, "2026-12-01")
	add(cafe, 0, "2026-12-10", "2026-12-20")
	// Palestra: 3 of 3 under Sport, none without: proposed, second.
	add(gym, sport, "2026-10-05", "2026-11-05", "2026-12-05")
	// Libreria: only 2 with a category.
	add(shop, books, "2026-10-07", "2026-11-07")
	add(shop, 0, "2026-12-07")
	// Bazar: 3 and 2, under four in five.
	add(odd, books, "2026-07-01", "2026-08-01", "2026-09-01")
	add(odd, sport, "2026-10-01", "2026-11-01")
	// Super: a rule already decides it.
	add(ruled, food, "2026-10-02", "2026-11-02", "2026-12-02")
	// Vecchio: older than twelve months.
	add(old, books, "2025-06-01", "2025-07-01", "2025-08-01")
	rules := assignment.NewServiceWithRead(st.Read(), st.Write())
	if _, err := rules.Create(ctx, w.ID, assignment.Input{
		MatchField: assignment.FieldPayee, MatchType: assignment.TypeContains, Pattern: "super", SetCategoryID: &food, ApplyOnManual: true,
	}); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		asked = append(asked, string(b))
		mu.Unlock()
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"Due beneficiari hanno sempre la stessa categoria."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	if _, err := aisvc.UpdateSettings(ctx, u.ID, true, ai.SettingsInput{
		Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key, Features: &ai.Features{Rules: true},
	}); err != nil {
		t.Fatal(err)
	}
	n := notify.NewService(st.Read(), st.Write(), nil)
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	svc.SetRules(rules)
	clock := time.Date(2027, 1, 15, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }

	basis, err := svc.ruleRows(ctx, w.ID, clock)
	if err != nil {
		t.Fatal(err)
	}
	type got struct {
		payee, category      int64
		name, path           string
		hits, total, without int
	}
	var rows []got
	for _, r := range basis.Rows {
		rows = append(rows, got{r.PayeeID, r.CategoryID, r.Name, r.Category, r.Hits, r.Total, r.Without})
	}
	want := []got{
		{cafe, bar, "Caffè", "Cibo:Bar", 4, 7, 2},
		{gym, sport, "Palestra", "Sport", 3, 3, 0},
	}
	if len(rows) != len(want) || rows[0] != want[0] || rows[1] != want[1] {
		t.Fatalf("rows = %+v, want %+v", rows, want)
	}

	// The scheduler: one proposal, one note pointing at Rules.
	for range 2 {
		if err := svc.RunScheduled(ctx); err != nil {
			t.Fatal(err)
		}
	}
	props, err := svc.Proposals(ctx, u.ID, w.ID)
	if err != nil || len(props) != 1 || props[0].Kind != KindRules || len(props[0].Basis.Rows) != 2 {
		t.Fatalf("proposals = %+v %v", props, err)
	}
	if len(asked) != 1 ||
		!strings.Contains(asked[0], "Caffè: Cibo:Bar in 4 of 7 transactions, 2 without a category") ||
		!strings.Contains(asked[0], "Palestra: Sport in 3 of 3 transactions\\n") ||
		!strings.Contains(asked[0], "In all, 2 transactions without a category") ||
		strings.Contains(asked[0], "12,34") || strings.Contains(asked[0], "12.34") || strings.Contains(asked[0], "segreto") {
		t.Fatalf("the model was asked %v", asked)
	}
	items, _, _ := n.List(ctx, u.ID)
	if len(items) != 1 || items[0].Title != "Regole da aggiungere" || items[0].URL != "/assignments" {
		t.Fatalf("bell = %+v", items)
	}
	if err := svc.Act(ctx, u.ID, w.ID, props[0].ID, ActionApplied, gym); err != nil {
		t.Fatal(err)
	}
	if props, _ = svc.Proposals(ctx, u.ID, w.ID); len(props[0].Basis.Rows) != 1 || props[0].Basis.Rows[0].PayeeID != cafe {
		t.Fatalf("after applying the gym = %+v", props[0].Basis.Rows)
	}
}

// An ignored rule proposal comes back with a payee new to it, another
// category, or half as many transactions more; not for less.
func TestRuleProposalChanged(t *testing.T) {
	was := []ProposalRow{{PayeeID: 1, CategoryID: 10, Total: 10}, {PayeeID: 2, CategoryID: 20, Total: 4}}
	for _, c := range []struct {
		name string
		rows []ProposalRow
		want bool
	}{
		{"the same", []ProposalRow{{PayeeID: 1, CategoryID: 10, Total: 10}}, false},
		{"a few more", []ProposalRow{{PayeeID: 1, CategoryID: 10, Total: 14}}, false},
		{"half as many more", []ProposalRow{{PayeeID: 1, CategoryID: 10, Total: 15}}, true},
		{"fewer", []ProposalRow{{PayeeID: 2, CategoryID: 20, Total: 1}}, false},
		{"another category", []ProposalRow{{PayeeID: 2, CategoryID: 21, Total: 4}}, true},
		{"a new payee", []ProposalRow{{PayeeID: 3, CategoryID: 10, Total: 3}}, true},
	} {
		if got := changedFrom(c.rows, was); got != c.want {
			t.Errorf("%s: changed = %v, want %v", c.name, got, c.want)
		}
	}
}
