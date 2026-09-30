package schedule

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/template"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// A month's calendar holds what was registered in it, even ahead of time, and
// what is still to register, with the one posting now would act on marked.
func TestCalendarRegisteredAndProjected(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	rent, err := f.s.Create(ctx, f.wid, Input{TemplateID: f.expenseTemplate(t, -75000), Unit: UnitMonth, EveryN: 1, NextDue: "2026-08-01"})
	if err != nil {
		t.Fatal(err)
	}
	// Rent registered three months ahead: August, September, October.
	for range 3 {
		if err := f.s.PostNow(ctx, rent.ID); err != nil {
			t.Fatal(err)
		}
	}
	energyTpl, _ := f.tpl.Create(ctx, f.wid, template.Input{Name: "Energy", AccountID: &f.accA, Amount: -7800})
	energy, _ := f.s.Create(ctx, f.wid, Input{TemplateID: energyTpl.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-09-26"})
	salaryTpl, _ := f.tpl.Create(ctx, f.wid, template.Input{Name: "Salary", AccountID: &f.accA, Amount: 245000})
	_, _ = f.s.Create(ctx, f.wid, Input{TemplateID: salaryTpl.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-09-30", AutoPost: true})

	cal, err := f.s.Calendar(ctx, f.wid, "2026-09-01", "2026-09-30", at(t, "2026-09-29"))
	if err != nil {
		t.Fatal(err)
	}
	type row struct {
		name, date, state string
		next              bool
	}
	var got []row
	for _, o := range cal.Occurrences {
		got = append(got, row{o.Name, o.Date, o.State, o.Next})
	}
	want := []row{
		{"Rent", "2026-09-01", StateRegistered, false},
		{"Energy", "2026-09-26", StateOverdue, true},
		{"Salary", "2026-09-30", StateDue, true},
	}
	if len(got) != len(want) {
		t.Fatalf("occurrences = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("occurrence %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	reg := cal.Occurrences[0]
	if reg.TransactionID == nil || reg.Status == nil || *reg.Status != transaction.StatusCleared || reg.ScheduleID == nil || *reg.ScheduleID != rent.ID {
		t.Errorf("registered rent = %+v, want its transaction, Cleared, schedule %d", reg, rent.ID)
	}
	if cal.Occurrences[1].Amount != -7800 || *cal.Occurrences[1].ScheduleID != energy.ID {
		t.Errorf("energy = %+v", cal.Occurrences[1])
	}

	// October: the rent registered ahead, then the projections.
	oct, _ := f.s.Calendar(ctx, f.wid, "2026-10-01", "2026-10-31", at(t, "2026-09-29"))
	if len(oct.Occurrences) != 3 || oct.Occurrences[0].State != StateRegistered || oct.Occurrences[1].Next {
		t.Errorf("october = %+v", oct.Occurrences)
	}
}

// Projection follows the weekend rule and stops at the occurrence limit.
func TestCalendarWeekendAndLimit(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	two := int64(2)
	// 2026-09-05 and 2026-10-05: a Saturday, then a Monday.
	_, _ = f.s.Create(ctx, f.wid, Input{TemplateID: f.expenseTemplate(t, -100), Unit: UnitMonth, EveryN: 1,
		NextDue: "2026-09-05", WeekendMode: WeekendAfter, Remaining: &two})
	cal, err := f.s.Calendar(ctx, f.wid, "2026-09-01", "2026-11-30", at(t, "2026-09-01"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cal.Occurrences) != 2 || cal.Occurrences[0].Date != "2026-09-07" || cal.Occurrences[1].Date != "2026-10-05" {
		t.Errorf("occurrences = %+v, want 09-07 and 10-05 only", cal.Occurrences)
	}
}

func TestCalendarRange(t *testing.T) {
	f := newFixture(t)
	for _, r := range [][2]string{{"2026-09-30", "2026-09-01"}, {"2026-01-01", "2026-06-01"}, {"x", "2026-09-01"}} {
		if _, err := f.s.Calendar(context.Background(), f.wid, r[0], r[1], time.Now()); !errors.Is(err, ErrInvalidRange) {
			t.Errorf("%v: err = %v, want ErrInvalidRange", r, err)
		}
	}
}

// Registering by hand can change the amount, the date and the status, but not
// the total of a split.
func TestPostNowWithOverride(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	sc, _ := f.s.Create(ctx, f.wid, Input{TemplateID: f.expenseTemplate(t, -7800), Unit: UnitMonth, EveryN: 1, NextDue: "2026-09-26"})
	amount, date, status := int64(-8340), "2026-09-28", transaction.StatusReconciled
	if err := f.s.PostNowWith(ctx, sc.ID, &Override{Amount: &amount, Date: &date, Status: &status}); err != nil {
		t.Fatal(err)
	}
	cal, _ := f.s.Calendar(ctx, f.wid, "2026-09-01", "2026-09-30", at(t, "2026-09-29"))
	o := cal.Occurrences[0]
	if o.State != StateRegistered || o.Amount != -8340 || o.Date != "2026-09-28" || *o.Status != transaction.StatusReconciled {
		t.Errorf("posted = %+v", o)
	}
	// The schedule moved on from its own due date, not the one posted.
	got, _ := f.s.Get(ctx, sc.ID)
	if got.NextDue != "2026-10-26" {
		t.Errorf("next due = %s, want 2026-10-26", got.NextDue)
	}

	split, _ := f.tpl.Create(ctx, f.wid, template.Input{Name: "Split", AccountID: &f.accA, Amount: -1000,
		Splits: []template.Split{{Amount: -600}, {Amount: -400}}})
	ssc, _ := f.s.Create(ctx, f.wid, Input{TemplateID: split.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-09-01"})
	other := int64(-1200)
	if err := f.s.PostNowWith(ctx, ssc.ID, &Override{Amount: &other}); !errors.Is(err, ErrSplitAmount) {
		t.Errorf("split with a new amount: err = %v, want ErrSplitAmount", err)
	}
	bad := "26/09"
	if err := f.s.PostNowWith(ctx, sc.ID, &Override{Date: &bad}); !errors.Is(err, ErrInvalidDate) {
		t.Errorf("bad date: err = %v, want ErrInvalidDate", err)
	}
}
