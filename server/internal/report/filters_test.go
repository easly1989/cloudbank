package report

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// The register's transfer, "no status" and "uncategorised" filters reach the
// reports too (#487): before, the report pages showed them and the server never
// heard of them.
func TestReportFilters(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	mk := func(in transaction.Input) int64 {
		t.Helper()
		in.AccountID, in.Date = f.acc, "2026-01-10"
		tx, err := f.ts.Create(ctx, f.wid, in)
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		return tx.ID
	}
	cleared := mk(transaction.Input{Amount: -1000, CategoryID: iptr(f.groc), Status: 1})
	uncat := mk(transaction.Input{Amount: -2000})
	split := mk(transaction.Input{Amount: -5000, Splits: []transaction.Split{
		{CategoryID: iptr(f.food), Amount: -2000}, {CategoryID: iptr(f.groc), Amount: -3000}}})
	out := mk(transaction.Input{Amount: -700})
	in := mk(transaction.Input{Amount: 700})
	if _, err := f.q.InsertTransfer(ctx, db.InsertTransferParams{TxnFromID: out, TxnToID: in}); err != nil {
		t.Fatalf("transfer: %v", err)
	}

	ids := func(fl Filter) map[int64]bool {
		t.Helper()
		rows, err := f.s.Drilldown(ctx, f.wid, fl, GroupMonth, "2026-01")
		if err != nil {
			t.Fatalf("drilldown: %v", err)
		}
		got := map[int64]bool{}
		for _, r := range rows {
			got[r.ID] = true
		}
		return got
	}
	same := func(name string, got map[int64]bool, want ...int64) {
		t.Helper()
		if len(got) != len(want) {
			t.Errorf("%s: got %v, want %v", name, got, want)
			return
		}
		for _, id := range want {
			if !got[id] {
				t.Errorf("%s: got %v, want %v", name, got, want)
				return
			}
		}
	}

	same("no filter", ids(Filter{}), cleared, uncat, split, out, in)
	same("transfers none", ids(Filter{Transfers: TransfersNone}), cleared, uncat, split)
	same("transfers only", ids(Filter{Transfers: TransfersOnly}), out, in)
	same("unknown transfers value keeps all", ids(Filter{Transfers: "sideways"}), cleared, uncat, split, out, in)
	same("no flags", ids(Filter{NoFlags: true}), uncat, split, out, in)
	// A split has its categories on its lines: it is not uncategorised.
	same("uncategorised", ids(Filter{Uncategorised: true}), uncat, out, in)
	same("uncategorised, no transfers", ids(Filter{Uncategorised: true, Transfers: TransfersNone}), uncat)

	// The statistics and the trend share the same conditions.
	st, err := f.s.Statistics(ctx, f.wid, Filter{NoFlags: true}, GroupMonth)
	if err != nil {
		t.Fatalf("statistics: %v", err)
	}
	if st.Total != -7000 {
		t.Errorf("statistics, no flags: total %d, want -7000", st.Total)
	}
	tr, err := f.s.Trend(ctx, f.wid, Filter{Transfers: TransfersOnly}, "month", "none")
	if err != nil {
		t.Fatalf("trend: %v", err)
	}
	var sum int64
	for _, s := range tr.Series {
		for _, v := range s.Values {
			sum += v
		}
	}
	if sum != 0 {
		t.Errorf("trend, transfers only: %d, want 0 (the two legs)", sum)
	}
}

// Spending and income are never mixed (#490): the type keeps one sign, and a
// split's lines are judged one by one, since one split can hold both.
func TestReportType(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	mk := func(in transaction.Input) int64 {
		t.Helper()
		in.AccountID, in.Date = f.acc, "2026-01-10"
		tx, err := f.ts.Create(ctx, f.wid, in)
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		return tx.ID
	}
	spent := mk(transaction.Input{Amount: -1500, CategoryID: iptr(f.food)})
	refund := mk(transaction.Input{Amount: 2000, CategoryID: iptr(f.food)})
	split := mk(transaction.Input{Amount: -5000, Splits: []transaction.Split{
		{CategoryID: iptr(f.food), Amount: -6000}, {CategoryID: iptr(f.groc), Amount: 1000}}})

	groups := func(typ string) map[string]int64 {
		t.Helper()
		res, err := f.s.Statistics(ctx, f.wid, Filter{Type: typ}, GroupSubcategory)
		if err != nil {
			t.Fatalf("statistics: %v", err)
		}
		got := map[string]int64{}
		for _, g := range res.Groups {
			got[g.Label] = g.Amount
		}
		return got
	}
	if got := groups(TypeExpense); len(got) != 1 || got["Food"] != -7500 {
		t.Errorf("expense = %v, want Food -7500 only", got)
	}
	if got := groups(TypeIncome); len(got) != 2 || got["Food"] != 2000 || got["Groceries"] != 1000 {
		t.Errorf("income = %v, want Food 2000, Groceries 1000", got)
	}
	if got := groups(""); got["Food"] != -5500 || got["Groceries"] != 1000 {
		t.Errorf("both = %v, want Food -5500, Groceries 1000", got)
	}

	ids := func(typ string, key int64) map[int64]bool {
		t.Helper()
		rows, err := f.s.Drilldown(ctx, f.wid, Filter{Type: typ}, GroupSubcategory, itoa(key))
		if err != nil {
			t.Fatalf("drilldown: %v", err)
		}
		got := map[int64]bool{}
		for _, r := range rows {
			got[r.ID] = true
		}
		return got
	}
	same := func(name string, got map[int64]bool, want ...int64) {
		t.Helper()
		if len(got) != len(want) {
			t.Errorf("%s: got %v, want %v", name, got, want)
			return
		}
		for _, id := range want {
			if !got[id] {
				t.Errorf("%s: got %v, want %v", name, got, want)
				return
			}
		}
	}
	same("food, expense", ids(TypeExpense, f.food), spent, split)
	same("food, income", ids(TypeIncome, f.food), refund)
	same("groceries, income", ids(TypeIncome, f.groc), split)
	same("groceries, expense", ids(TypeExpense, f.groc))
}
