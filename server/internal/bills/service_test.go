package bills

import (
	"context"
	"database/sql"
	"fmt"
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

// addScheduleCat inserts a monthly auto-post outflow schedule whose template
// carries the given category.
func (f fixture) addScheduleCat(t *testing.T, name string, amount int64, nextDue string, categoryID int64) int64 {
	t.Helper()
	ctx := context.Background()
	acc, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: f.walletID, Name: name + " acct", Type: "checking", CurrencyID: f.eurID, Position: 1,
	})
	tpl, _ := f.q.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: f.walletID, Name: name, AccountID: sql.NullInt64{Int64: acc.ID, Valid: true},
		Amount: amount, CategoryID: sql.NullInt64{Int64: categoryID, Valid: true},
	})
	sc, err := f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: f.walletID, TemplateID: tpl.ID, Unit: "month", EveryN: 1,
		NextDue: nextDue, WeekendMode: 0, Remaining: sql.NullInt64{}, PostAdvance: 0, AutoPost: 1,
	})
	if err != nil {
		t.Fatalf("InsertSchedule(%s): %v", name, err)
	}
	return sc.ID
}

func setBillsCategory(t *testing.T, f fixture, categoryID int64) {
	t.Helper()
	w, _ := f.q.GetWallet(context.Background(), f.walletID)
	if err := f.q.UpdateWallet(context.Background(), db.UpdateWalletParams{
		Title: w.Title, OwnerName: w.OwnerName,
		SettingsJson: fmt.Sprintf(`{"billsCategoryId":%d}`, categoryID), ID: f.walletID,
	}); err != nil {
		t.Fatalf("UpdateWallet: %v", err)
	}
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

	today, from := "2026-06-15", "2026-06-01"
	sum, err := svc.Bills(ctx, f.walletID, from, today)
	if err != nil {
		t.Fatalf("Bills: %v", err)
	}

	if len(byName(sum.Bills, "Salary")) != 0 {
		t.Fatalf("income schedule must be excluded, got %+v", sum.Bills)
	}
	// One row per bill: Rent's next-due (2026-06-01) is overdue as of today.
	rent := byName(sum.Bills, "Rent")
	if len(rent) != 1 {
		t.Fatalf("Rent occurrences = %d, want 1 (next-due only) (%+v)", len(rent), rent)
	}
	if rent[0].State != StateOverdue || rent[0].DueDate != "2026-06-01" {
		t.Fatalf("Rent = %+v, want overdue 2026-06-01", rent[0])
	}
	if sum.Overdue != 1 || sum.Due != 0 || sum.Paid != 0 {
		t.Fatalf("counts = overdue %d due %d paid %d, want 1/0/0", sum.Overdue, sum.Due, sum.Paid)
	}
	if sum.TotalDue != 100000 {
		t.Fatalf("TotalDue = %d, want 100000", sum.TotalDue)
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

	today, from := "2026-06-15", "2026-06-01"
	sum, err := svc.Bills(ctx, f.walletID, from, today)
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

func TestBillsFuturePrePostNotPaid(t *testing.T) {
	svc, f := newFixture(t)
	ctx := context.Background()
	// An auto-post bill pre-registered ahead: last_posted and next_due are both in
	// the future relative to today. The future post must NOT show as "paid" — the
	// bill shows its real next-due as upcoming instead.
	sc := f.addSchedule(t, "AutoBill", -5000, "month", "2026-09-05", 1, 0, nil)
	if err := f.q.AdvanceSchedule(ctx, db.AdvanceScheduleParams{
		NextDue: "2026-10-05", Remaining: sql.NullInt64{},
		LastPosted: sql.NullString{String: "2026-09-05", Valid: true}, ID: sc,
	}); err != nil {
		t.Fatalf("AdvanceSchedule: %v", err)
	}
	sum, err := svc.Bills(ctx, f.walletID, "2026-08-01", "2026-08-15")
	if err != nil {
		t.Fatalf("Bills: %v", err)
	}
	b := byName(sum.Bills, "AutoBill")
	if len(b) != 1 {
		t.Fatalf("AutoBill rows = %d, want 1 (upcoming only) (%+v)", len(b), b)
	}
	if b[0].State != StateDue || b[0].DueDate != "2026-10-05" {
		t.Fatalf("AutoBill = %+v, want due 2026-10-05", b[0])
	}
	if !b[0].AutoPost {
		t.Fatalf("AutoBill should be flagged autoPost")
	}
	if sum.Paid != 0 {
		t.Fatalf("Paid = %d, want 0 (a future pre-post is not paid)", sum.Paid)
	}
}

func TestBillsCategoryFilter(t *testing.T) {
	svc, f := newFixture(t)
	ctx := context.Background()
	billsCat, err := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.walletID, Name: "Bills & Taxes"})
	if err != nil {
		t.Fatalf("InsertCategory: %v", err)
	}
	otherCat, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.walletID, Name: "Groceries"})
	f.addScheduleCat(t, "Electricity", -6000, "2026-06-10", billsCat.ID)
	f.addScheduleCat(t, "Supermarket", -3000, "2026-06-11", otherCat.ID)

	// No category configured → every outflow is a bill.
	sum, _ := svc.Bills(ctx, f.walletID, "2026-06-01", "2026-06-15")
	if len(byName(sum.Bills, "Electricity")) != 1 || len(byName(sum.Bills, "Supermarket")) != 1 {
		t.Fatalf("without a category filter both should appear: %+v", sum.Bills)
	}

	// Configure the bills category → only its schedules appear.
	setBillsCategory(t, f, billsCat.ID)
	sum2, _ := svc.Bills(ctx, f.walletID, "2026-06-01", "2026-06-15")
	if len(byName(sum2.Bills, "Electricity")) != 1 {
		t.Fatalf("Electricity (bills category) should appear: %+v", sum2.Bills)
	}
	if len(byName(sum2.Bills, "Supermarket")) != 0 {
		t.Fatalf("Supermarket (other category) should be filtered out: %+v", sum2.Bills)
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

	today, from := "2026-06-15", "2026-06-01"
	sum, err := svc.Bills(ctx, f.walletID, from, today)
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
