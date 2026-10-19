package schedule

import (
	"context"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
)

// series is n payments of amount, step apart (days, or months when months is
// set), ending on last.
func series(last string, n, days, months int, amount int64) []Paid {
	end, _ := ParseDate(last)
	out := make([]Paid, n)
	for i := 0; i < n; i++ {
		d := end.AddDate(0, -months*(n-1-i), -days*(n-1-i))
		out[i] = Paid{Date: FormatDate(d), Amount: amount, AccountID: 1}
	}
	return out
}

func TestDetect(t *testing.T) {
	today, _ := ParseDate("2026-10-19")
	cases := []struct {
		name    string
		paid    []Paid
		want    Cadence // "" when nothing is recurring
		amount  int64
		count   int
		nextDue string
		yearly  int64
	}{
		{name: "monthly", paid: series("2026-10-02", 6, 0, 1, -3500), want: Monthly, amount: -3500, count: 6, nextDue: "2026-11-02", yearly: -42000},
		{name: "weekly", paid: series("2026-10-16", 5, 7, 0, -1200), want: Weekly, amount: -1200, count: 5, nextDue: "2026-10-23", yearly: -62400},
		{name: "quarterly", paid: series("2026-09-10", 3, 0, 3, -9000), want: Quarterly, amount: -9000, count: 3, nextDue: "2026-12-10", yearly: -36000},
		{name: "yearly", paid: series("2026-03-12", 2, 0, 12, -18000), want: Yearly, amount: -18000, count: 2, nextDue: "2027-03-12", yearly: -18000},
		{name: "income", paid: series("2026-10-10", 4, 0, 1, 8000), want: Monthly, amount: 8000, count: 4, nextDue: "2026-11-10", yearly: 96000},
		{
			name: "amount varies a little", want: Monthly, amount: -6425, count: 4, nextDue: "2026-11-05", yearly: -77100,
			paid: []Paid{
				{Date: "2026-07-05", Amount: -6100, AccountID: 1}, {Date: "2026-08-04", Amount: -6400, AccountID: 1},
				{Date: "2026-09-06", Amount: -6600, AccountID: 1}, {Date: "2026-10-05", Amount: -6450, AccountID: 1},
			},
		},
		{
			name: "dates move by a few days", want: Monthly, amount: -2990, count: 4, nextDue: "2026-11-06", yearly: -35880,
			paid: []Paid{
				{Date: "2026-07-03", Amount: -2990, AccountID: 1}, {Date: "2026-08-05", Amount: -2990, AccountID: 1},
				{Date: "2026-09-02", Amount: -2990, AccountID: 1}, {Date: "2026-10-06", Amount: -2990, AccountID: 1},
			},
		},
		{
			name: "irregular",
			paid: []Paid{
				{Date: "2026-03-01", Amount: -2000, AccountID: 1}, {Date: "2026-03-20", Amount: -2000, AccountID: 1},
				{Date: "2026-06-11", Amount: -2000, AccountID: 1}, {Date: "2026-07-02", Amount: -2000, AccountID: 1},
				{Date: "2026-09-30", Amount: -2000, AccountID: 1},
			},
		},
		{
			name: "amount varies too much",
			paid: []Paid{
				{Date: "2026-07-05", Amount: -3800, AccountID: 1}, {Date: "2026-08-05", Amount: -8900, AccountID: 1},
				{Date: "2026-09-05", Amount: -5200, AccountID: 1}, {Date: "2026-10-05", Amount: -2100, AccountID: 1},
			},
		},
		{name: "too few", paid: series("2026-10-02", 2, 0, 1, -3500)},
		{name: "stopped", paid: series("2026-06-02", 6, 0, 1, -3500)},
		{name: "older than the look-back", paid: series("2025-08-02", 3, 0, 3, -9000)},
		{
			// A one-off of another amount in the middle is left out, not a break.
			name: "one-off among them", want: Monthly, amount: -1099, count: 4, nextDue: "2026-11-15", yearly: -13188,
			paid: []Paid{
				{Date: "2026-07-15", Amount: -1099, AccountID: 1}, {Date: "2026-08-15", Amount: -1099, AccountID: 1},
				{Date: "2026-08-20", Amount: -4999, AccountID: 1}, {Date: "2026-09-15", Amount: -1099, AccountID: 1},
				{Date: "2026-10-15", Amount: -1099, AccountID: 1},
			},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := Detect(c.paid, today)
			if c.want == "" {
				if ok {
					t.Fatalf("found %+v, want nothing", got)
				}
				return
			}
			if !ok {
				t.Fatalf("found nothing, want %s", c.want)
			}
			if got.Cadence != c.want || got.Amount != c.amount || got.Count != c.count || got.NextDue != c.nextDue || got.Yearly != c.yearly {
				t.Fatalf("got %+v, want %s %d ×%d next %s yearly %d", got, c.want, c.amount, c.count, c.nextDue, c.yearly)
			}
		})
	}
}

// Proposals keep two look-alike payees apart, leave out a payee a schedule
// pays, transfers and what was ignored, and an ignored cadence stays ignored.
func TestProposals(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	today, _ := ParseDate("2026-10-19")
	txns := transaction.NewService(f.s.db)
	payee := func(name string) int64 {
		p, err := f.q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: f.wid, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	pay := func(payee int64, amount int64, dates ...string) {
		for _, d := range dates {
			if _, err := txns.Create(ctx, f.wid, transaction.Input{AccountID: f.accA, Date: d, Amount: amount, PayeeID: &payee}); err != nil {
				t.Fatal(err)
			}
		}
	}
	bus := payee("Bus company")
	pay(bus, -3500, "2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02")
	music := payee("Music")
	pay(music, -1099, "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15")
	// Two cafés a reader may think of as one: neither recurs on its own.
	bar := payee("Bar Centrale")
	pay(bar, -250, "2026-07-05", "2026-09-05")
	barSrl := payee("Bar Centrale Srl")
	pay(barSrl, -250, "2026-08-05", "2026-10-05")
	// The fixture's schedule pays its payee: not proposed again.
	pay(f.payee, -100000, "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01")
	if _, err := f.s.Create(ctx, f.wid, Input{TemplateID: f.expenseTemplate(t, -100000), Unit: UnitMonth, EveryN: 1, NextDue: "2026-11-01"}); err != nil {
		t.Fatal(err)
	}
	// Transfers are not payments.
	xfer := transfer.NewService(f.s.db)
	for _, d := range []string{"2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10"} {
		if _, err := xfer.Create(ctx, f.wid, transfer.Input{FromAccountID: f.accA, ToAccountID: f.accB, Date: d, FromAmount: 20000}); err != nil {
			t.Fatal(err)
		}
	}

	got, err := f.s.Proposals(ctx, f.wid, today)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].PayeeID != bus || got[1].PayeeID != music {
		t.Fatalf("proposals = %+v, want the bus then the music", got)
	}
	if p := got[0]; p.Cadence != "monthly" || p.Unit != UnitMonth || p.EveryN != 1 || p.Yearly != -42000 || p.NextDue != "2026-11-02" || p.PayeeName != "Bus company" {
		t.Fatalf("bus = %+v", p)
	}

	if err := f.s.Ignore(ctx, f.wid, music, "monthly"); err != nil {
		t.Fatal(err)
	}
	if err := f.s.Ignore(ctx, f.wid, music, "monthly"); err != nil {
		t.Fatalf("ignoring twice: %v", err)
	}
	if got, _ := f.s.Proposals(ctx, f.wid, today); len(got) != 1 || got[0].PayeeID != bus {
		t.Fatalf("after ignoring the music = %+v", got)
	}
	if err := f.s.Ignore(ctx, f.wid, bus, "fortnightly"); !errors.Is(err, ErrInvalidCadence) {
		t.Fatalf("bad cadence: %v", err)
	}
	if err := f.s.Ignore(ctx, f.wid+1, bus, "monthly"); !errors.Is(err, ErrPayee) {
		t.Fatalf("another wallet's payee: %v", err)
	}
}
