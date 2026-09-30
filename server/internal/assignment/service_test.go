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
	res, ok, err := f.s.Suggest(ctx, f.wid, Subject{Memo: "morning coffee"})
	if err != nil || !ok || res.CategoryID == nil || *res.CategoryID != food {
		t.Fatalf("suggest = %+v ok=%v err=%v", res, ok, err)
	}

	// A manual-disabled rule is ignored by Suggest.
	car := f.category(t, "Car")
	_, _ = f.s.Create(ctx, f.wid, Input{
		MatchField: FieldMemo, MatchType: TypeContains, Pattern: "fuel",
		SetCategoryID: &car, ApplyOnManual: false,
	})
	if _, ok, _ := f.s.Suggest(ctx, f.wid, Subject{Memo: "fuel station"}); ok {
		t.Fatalf("manual-disabled rule should not be suggested")
	}
}

func TestTestPreview(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-15", Amount: -500, Memo: "Coffee Bar"})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-16", Amount: -900, Memo: "Groceries"})

	res, err := f.s.Test(ctx, f.wid, 0, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "coffee"}, 50)
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if res.Count != 1 || res.WithoutCategory != 1 || len(res.Latest) != 1 || res.Latest[0].Memo != "Coffee Bar" {
		t.Fatalf("test = %+v", res)
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

	n, err := f.s.ApplyToExisting(ctx, f.wid, nil, nil, true)
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

	if res, _, _ := f.s.Suggest(ctx, f.wid, Subject{Memo: "xx"}); res.CategoryID == nil || *res.CategoryID != a {
		t.Fatalf("before reorder should match A")
	}
	if err := f.s.Reorder(ctx, f.wid, []int64{r2.ID, r1.ID}); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if res, _, _ := f.s.Suggest(ctx, f.wid, Subject{Memo: "xx"}); res.CategoryID == nil || *res.CategoryID != b {
		t.Fatalf("after reorder should match B")
	}
}

// A rule adds its tags and reads a transaction's tags; the list counts what
// each rule decides; the tester says what a rule above takes first; applying
// one rule leaves the others' transactions alone. Nothing is written by the
// tester or the list.
func TestTagsCountsAndOneRule(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	fuel := f.category(t, "Fuel")
	food := f.category(t, "Food")
	petrol, err := f.s.Create(ctx, f.wid, Input{
		MatchField: FieldMemo, MatchType: TypeContains, Pattern: "petrol",
		SetCategoryID: &fuel, SetTags: []string{"car", " car ", ""}, ApplyOnManual: true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(petrol.SetTags) != 1 || petrol.SetTags[0] != "car" {
		t.Fatalf("setTags = %v, want [car]", petrol.SetTags)
	}
	shadow, _ := f.s.Create(ctx, f.wid, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "pet", SetCategoryID: &food})
	byTag, _ := f.s.Create(ctx, f.wid, Input{MatchField: FieldTag, MatchType: TypeExact, Pattern: "holiday", SetCategoryID: &food})

	t1, _ := f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-15", Amount: -5000, Memo: "Petrol", Tags: []string{"work"}})
	t2, _ := f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-16", Amount: -900, Memo: "Hotel", Tags: []string{"holiday"}})

	list, err := f.s.List(ctx, f.wid)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	want := map[int64][2]int{petrol.ID: {1, 1}, shadow.ID: {0, 1}, byTag.ID: {1, 1}}
	for _, d := range list {
		if d.Matches == nil || d.Reach == nil || *d.Matches != want[d.ID][0] || *d.Reach != want[d.ID][1] {
			t.Fatalf("rule %d: matches/reach = %v/%v, want %v", d.ID, d.Matches, d.Reach, want[d.ID])
		}
	}

	res, _ := f.s.Test(ctx, f.wid, shadow.ID, Input{MatchField: FieldMemo, MatchType: TypeContains, Pattern: "pet"}, 5)
	if res.Count != 1 || res.Taken != 1 || res.WithoutCategory != 0 {
		t.Fatalf("shadowed test = %+v", res)
	}
	if g, _ := f.ts.Get(ctx, t1.ID); g.CategoryID != nil {
		t.Fatalf("the tester wrote a category")
	}

	if s, ok, _ := f.s.Suggest(ctx, f.wid, Subject{Memo: "petrol"}); !ok || len(s.Tags) != 1 || s.Tags[0] != "car" {
		t.Fatalf("suggest = %+v, %v", s, ok)
	}

	// Only the tag rule: the hotel is filed, the petrol is not touched.
	n, err := f.s.ApplyToExisting(ctx, f.wid, nil, &byTag.ID, true)
	if err != nil || n != 1 {
		t.Fatalf("apply one rule = %d, %v", n, err)
	}
	if g, _ := f.ts.Get(ctx, t1.ID); g.CategoryID != nil || len(g.Tags) != 1 {
		t.Fatalf("petrol changed by another rule's apply: %+v", g)
	}
	if g, _ := f.ts.Get(ctx, t2.ID); g.CategoryID == nil || *g.CategoryID != food {
		t.Fatalf("hotel not filed: %+v", g.CategoryID)
	}

	// All rules: the petrol gets Fuel and car, and keeps work.
	if _, err := f.s.ApplyToExisting(ctx, f.wid, nil, nil, true); err != nil {
		t.Fatalf("apply: %v", err)
	}
	g, _ := f.ts.Get(ctx, t1.ID)
	if g.CategoryID == nil || *g.CategoryID != fuel || len(g.Tags) != 2 {
		t.Fatalf("petrol = category %v tags %v, want Fuel and [car work]", g.CategoryID, g.Tags)
	}
	// Applying again changes nothing: the tag is already there.
	if n, _ := f.s.ApplyToExisting(ctx, f.wid, nil, nil, true); n != 0 {
		t.Fatalf("second apply changed %d", n)
	}
}
