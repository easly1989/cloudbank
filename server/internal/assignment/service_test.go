package assignment

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

type fixture struct {
	s   *Service
	ts  *transaction.Service
	q   *db.Queries
	wid int64
	acc int64
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	a, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	return fixture{s: NewService(st.Write()), ts: transaction.NewService(st.Write()), q: q, wid: w.ID, acc: a.ID}
}

func (f fixture) category(t *testing.T, name string) int64 {
	t.Helper()
	c, _ := f.q.InsertCategory(context.Background(), db.InsertCategoryParams{WalletID: f.wid, Name: name})
	return c.ID
}

func TestCreateRejectsBadRegex(t *testing.T) {
	f := newFixture(t)
	_, err := f.s.Create(context.Background(), f.wid, Input{MatchField: FieldMemo, MatchType: TypeRegex, Pattern: "a("})
	if err != ErrInvalidRegex {
		t.Fatalf("bad regex = %v, want ErrInvalidRegex", err)
	}
}

func TestSuggestRespectsApplyOnManual(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food")
	_, _ = f.s.Create(ctx, f.wid, Input{
		MatchField: FieldMemo, MatchType: TypeContains, Pattern: "coffee",
		SetCategoryID: &food, ApplyOnManual: true,
	})
	res, ok, err := f.s.Suggest(ctx, f.wid, "morning coffee", "", 0)
	if err != nil || !ok || res.CategoryID == nil || *res.CategoryID != food {
		t.Fatalf("suggest = %+v ok=%v err=%v", res, ok, err)
	}

	// A manual-disabled rule is ignored by Suggest.
	car := f.category(t, "Car")
	_, _ = f.s.Create(ctx, f.wid, Input{
		MatchField: FieldMemo, MatchType: TypeContains, Pattern: "fuel",
		SetCategoryID: &car, ApplyOnManual: false,
	})
	if _, ok, _ := f.s.Suggest(ctx, f.wid, "fuel station", "", 0); ok {
		t.Fatalf("manual-disabled rule should not be suggested")
	}
}

func TestTestPreview(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-15", Amount: -500, Memo: "Coffee Bar"})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-16", Amount: -900, Memo: "Groceries"})

	matches, err := f.s.Test(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "coffee"}, 50)
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if len(matches) != 1 || matches[0].Memo != "Coffee Bar" {
		t.Fatalf("matches = %+v", matches)
	}
}

func TestApplyToExistingFirstMatchAndFillEmpty(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food")
	delivery := f.category(t, "Delivery")
	// First-match-wins: "uber" before "eats".
	_, _ = f.s.Create(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "uber", SetCategoryID: &food})
	_, _ = f.s.Create(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "eats", SetCategoryID: &delivery})

	t1, _ := f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-15", Amount: -2000, Memo: "uber eats dinner"})
	preset := f.category(t, "Preset")
	t2, _ := f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-16", Amount: -3000, Memo: "uber ride", CategoryID: &preset})

	n, err := f.s.ApplyToExisting(ctx, f.wid, nil, true)
	if err != nil {
		t.Fatalf("ApplyToExisting: %v", err)
	}
	if n != 1 { // t1 gets Food; t2 already has a category and is left alone (fill-empty)
		t.Fatalf("changed = %d, want 1", n)
	}
	g1, _ := f.ts.Get(ctx, t1.ID)
	if g1.CategoryID == nil || *g1.CategoryID != food {
		t.Fatalf("t1 category = %v, want Food (first match)", g1.CategoryID)
	}
	g2, _ := f.ts.Get(ctx, t2.ID)
	if g2.CategoryID == nil || *g2.CategoryID != preset {
		t.Fatalf("t2 category overwritten: %v", g2.CategoryID)
	}
}

func TestReorderChangesFirstMatch(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a := f.category(t, "A")
	b := f.category(t, "B")
	r1, _ := f.s.Create(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "x", SetCategoryID: &a, ApplyOnManual: true})
	r2, _ := f.s.Create(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "x", SetCategoryID: &b, ApplyOnManual: true})

	if res, _, _ := f.s.Suggest(ctx, f.wid, "xx", "", 0); res.CategoryID == nil || *res.CategoryID != a {
		t.Fatalf("before reorder should match A")
	}
	if err := f.s.Reorder(ctx, f.wid, []int64{r2.ID, r1.ID}); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if res, _, _ := f.s.Suggest(ctx, f.wid, "xx", "", 0); res.CategoryID == nil || *res.CategoryID != b {
		t.Fatalf("after reorder should match B")
	}
}
