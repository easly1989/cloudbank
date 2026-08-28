package bills

import (
	"context"
	"database/sql"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

type fixture struct {
	q        *db.Queries
	walletID int64
	eurID    int64
}

func newFixture(t *testing.T) (*Service, fixture) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	eur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	return NewService(st.Write()), fixture{q: q, walletID: w.ID, eurID: eur.ID}
}

// addSchedule inserts an account-backed template and a schedule for it,
// returning the schedule id. currencyID <= 0 uses the fixture's EUR account.
func (f fixture) addSchedule(t *testing.T, name string, amount int64, unit, nextDue string, everyN int, currencyID int64, remaining *int64) int64 {
	t.Helper()
	ctx := context.Background()
	if currencyID <= 0 {
		currencyID = f.eurID
	}
	acc, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: f.walletID, Name: name + " acct", Type: "checking", CurrencyID: currencyID, Position: 1,
	})
	tpl, _ := f.q.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: f.walletID, Name: name, AccountID: sql.NullInt64{Int64: acc.ID, Valid: true}, Amount: amount,
	})
	rem := sql.NullInt64{}
	if remaining != nil {
		rem = sql.NullInt64{Int64: *remaining, Valid: true}
	}
	sc, err := f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: f.walletID, TemplateID: tpl.ID, Unit: unit, EveryN: int64(everyN),
		NextDue: nextDue, WeekendMode: 0, Remaining: rem, PostAdvance: 0, AutoPost: 1,
	})
	if err != nil {
		t.Fatalf("InsertSchedule(%s): %v", name, err)
	}
	return sc.ID
}

func byName(bills []Bill, name string) []Bill {
	var out []Bill
	for _, b := range bills {
		if b.Name == name {
			out = append(out, b)
		}
	}
	return out
}

func TestBillsClassification(t *testing.T) {
	svc, f := newFixture(t)
	ctx := context.Background()
	// Rent falls due on the 1st: last month's is overdue, next month's is due.
	f.addSchedule(t, "Rent", -100000, "month", "2026-06-01", 1, 0, nil)
	// Salary is income (positive) → excluded from the Bills view entirely.
	f.addSchedule(t, "Salary", 250000, "month", "2026-06-25", 1, 0, nil)

	today, from, to := "2026-06-15", "2026-06-01", "2026-07-31"
	sum, err := svc.Bills(ctx, f.walletID, from, to, today)
	if err != nil {
		t.Fatalf("Bills: %v", err)
	}

	if len(byName(sum.Bills, "Salary")) != 0 {
		t.Fatalf("income schedule must be excluded, got %+v", sum.Bills)
	}
	rent := byName(sum.Bills, "Rent")
	if len(rent) != 2 {
		t.Fatalf("Rent occurrences = %d, want 2 (%+v)", len(rent), rent)
	}
	// Sorted overdue-first, then due.
	if rent[0].State != StateOverdue || rent[0].DueDate != "2026-06-01" {
		t.Fatalf("first Rent = %+v, want overdue 2026-06-01", rent[0])
	}
	if rent[1].State != StateDue || rent[1].DueDate != "2026-07-01" {
		t.Fatalf("second Rent = %+v, want due 2026-07-01", rent[1])
	}
	if sum.Overdue != 1 || sum.Due != 1 || sum.Paid != 0 {
		t.Fatalf("counts = overdue %d due %d paid %d, want 1/1/0", sum.Overdue, sum.Due, sum.Paid)
	}
	// Left to pay = both unpaid Rent occurrences, as a positive magnitude.
	if sum.TotalDue != 200000 {
		t.Fatalf("TotalDue = %d, want 200000", sum.TotalDue)
	}
}

func TestBillsPaidAndRemainingCap(t *testing.T) {
	svc, f := newFixture(t)
	ctx := context.Background()

	// Gym: its July occurrence is upcoming; it was already paid on Jun 5, which
	// we record via last_posted (keeping next_due at the July occurrence).
	gym := f.addSchedule(t, "Gym", -4000, "month", "2026-07-05", 1, 0, nil)
	if err := f.q.AdvanceSchedule(ctx, db.AdvanceScheduleParams{
		NextDue: "2026-07-05", Remaining: sql.NullInt64{}, LastPosted: sql.NullString{String: "2026-06-05", Valid: true}, ID: gym,
	}); err != nil {
		t.Fatalf("AdvanceSchedule: %v", err)
	}
	// OneTime: a finite schedule with a single occurrence left must not repeat.
	one := int64(1)
	f.addSchedule(t, "OneTime", -9000, "month", "2026-06-10", 1, 0, &one)

	today, from, to := "2026-06-15", "2026-06-01", "2026-07-31"
	sum, err := svc.Bills(ctx, f.walletID, from, to, today)
	if err != nil {
		t.Fatalf("Bills: %v", err)
	}

	gymBills := byName(sum.Bills, "Gym")
	if len(gymBills) != 2 {
		t.Fatalf("Gym bills = %d, want 2 (paid + due) (%+v)", len(gymBills), gymBills)
	}
	var paid, due int
	for _, b := range gymBills {
		switch b.State {
		case StatePaid:
			paid++
			if b.DueDate != "2026-06-05" {
				t.Fatalf("paid Gym date = %s, want 2026-06-05", b.DueDate)
			}
		case StateDue:
			due++
		}
	}
	if paid != 1 || due != 1 {
		t.Fatalf("Gym paid/due = %d/%d, want 1/1", paid, due)
	}

	oneTime := byName(sum.Bills, "OneTime")
	if len(oneTime) != 1 {
		t.Fatalf("OneTime with remaining=1 must yield exactly 1 occurrence, got %d", len(oneTime))
	}
	if oneTime[0].State != StateOverdue {
		t.Fatalf("OneTime state = %s, want overdue", oneTime[0].State)
	}
	// The paid occurrence never counts toward "left to pay".
	if sum.Paid != 1 {
		t.Fatalf("Paid count = %d, want 1", sum.Paid)
	}
	if sum.TotalDue != 4000+9000 {
		t.Fatalf("TotalDue = %d, want 13000 (Gym due + OneTime overdue)", sum.TotalDue)
	}
}

func TestBillsConvertsToBaseCurrency(t *testing.T) {
	svc, f := newFixture(t)
	ctx := context.Background()
	// A USD account with rate 0.5 EUR per USD; a $200.00 bill → €100.00 base.
	usd, _ := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: f.walletID, IsoCode: "USD", Name: "US Dollar", Symbol: "$",
		SymbolPrefix: 1, DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 0, Rate: 0.5,
	})
	f.addSchedule(t, "Hosting", -20000, "month", "2026-06-10", 1, usd.ID, nil)

	today, from, to := "2026-06-15", "2026-06-01", "2026-06-30"
	sum, err := svc.Bills(ctx, f.walletID, from, to, today)
	if err != nil {
		t.Fatalf("Bills: %v", err)
	}
	h := byName(sum.Bills, "Hosting")
	if len(h) != 1 {
		t.Fatalf("Hosting bills = %d, want 1", len(h))
	}
	if h[0].Amount != -20000 || h[0].Currency.Code != "USD" {
		t.Fatalf("Hosting amount/currency = %d/%s, want -20000/USD", h[0].Amount, h[0].Currency.Code)
	}
	if h[0].BaseAmount != -10000 {
		t.Fatalf("Hosting baseAmount = %d, want -10000 (€100.00)", h[0].BaseAmount)
	}
	if sum.TotalDue != 10000 {
		t.Fatalf("TotalDue = %d, want 10000 (base currency)", sum.TotalDue)
	}
	if sum.BaseCurrency == nil || sum.BaseCurrency.Code != "EUR" {
		t.Fatalf("BaseCurrency = %+v, want EUR", sum.BaseCurrency)
	}
}
