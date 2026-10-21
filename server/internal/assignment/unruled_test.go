package assignment

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestUnruledTalliesWhatNoRuleDecides(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	payee := func(name string) int64 {
		p, err := f.q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: f.wid, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	food, sport := f.category(t, "Food"), f.category(t, "Sport")
	cafe, gym, shop := payee("Café"), payee("Gym"), payee("Shop")
	add := func(date string, p int64, cat *int64, memo string) {
		t.Helper()
		if _, err := f.ts.Create(ctx, f.wid, transaction.Input{
			AccountID: f.acc, Date: date, Amount: -500, PayeeID: &p, CategoryID: cat, Memo: memo,
		}); err != nil {
			t.Fatal(err)
		}
	}
	add("2025-01-10", cafe, &food, "") // before since: left out
	add("2026-01-10", cafe, &food, "")
	add("2026-02-10", cafe, &food, "")
	add("2026-03-10", cafe, &sport, "")
	add("2026-04-10", cafe, nil, "")
	add("2026-02-01", gym, &sport, "monthly")
	add("2026-03-01", gym, &sport, "")
	add("2026-01-05", shop, &food, "")
	// A split one is left out.
	if _, err := f.ts.Create(ctx, f.wid, transaction.Input{
		AccountID: f.acc, Date: "2026-05-01", Amount: -1000, PayeeID: &cafe,
		Splits: []transaction.Split{{CategoryID: &food, Amount: -400}, {CategoryID: &sport, Amount: -600}},
	}); err != nil {
		t.Fatal(err)
	}
	// A rule already decides the gym's "monthly" one and every shop one.
	if _, err := f.s.Create(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "monthly", SetTags: []string{"x"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.Create(ctx, f.wid, Input{MatchField: FieldPayee, MatchType: TypeExact, Pattern: "Shop", SetCategoryID: &food}); err != nil {
		t.Fatal(err)
	}

	got, err := f.s.Unruled(ctx, f.wid, "2026-01-01")
	if err != nil {
		t.Fatal(err)
	}
	by := map[int64]PayeeTally{}
	for _, p := range got {
		by[p.PayeeID] = p
	}
	if _, ok := by[shop]; ok {
		t.Errorf("shop is decided by a rule, got %+v", by[shop])
	}
	c := by[cafe]
	if c.Payee != "Café" || c.Total != 4 || c.Without != 1 || c.Categories[food] != 2 || c.Categories[sport] != 1 {
		t.Errorf("café = %+v", c)
	}
	g := by[gym]
	if g.Total != 1 || g.Categories[sport] != 1 {
		t.Errorf("gym = %+v, want the one no rule matches", g)
	}
}
