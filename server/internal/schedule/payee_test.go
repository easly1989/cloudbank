package schedule

import (
	"context"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/template"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// An income or expense schedule needs a payee; a transfer has none (#723).
func TestScheduleNeedsPayee(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	bare, err := f.tpl.Create(ctx, f.wid, template.Input{Name: "Gym", AccountID: &f.accA, Amount: -4500})
	if err != nil {
		t.Fatal(err)
	}
	in := Input{TemplateID: bare.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15"}
	if _, err := f.s.Create(ctx, f.wid, in); !errors.Is(err, ErrPayeeRequired) {
		t.Fatalf("create without payee: got %v, want ErrPayeeRequired", err)
	}

	move, _ := f.tpl.Create(ctx, f.wid, template.Input{
		Name: "Move", IsTransfer: true, AccountID: &f.accA, ToAccountID: &f.accB, Amount: -5000,
	})
	if _, err := f.s.Create(ctx, f.wid, Input{TemplateID: move.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15"}); err != nil {
		t.Fatalf("transfer without payee: %v", err)
	}

	// One saved before the rule (an import) is not saved again without one.
	old, err := f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: f.wid, TemplateID: bare.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.Update(ctx, f.wid, old.ID, in); !errors.Is(err, ErrPayeeRequired) {
		t.Fatalf("update without payee: got %v, want ErrPayeeRequired", err)
	}
}

// The list says who each schedule pays and how many of the transactions it
// registered have no payee; applying the payee fills those, and only those.
func TestApplyPayee(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	txns := transaction.NewService(f.s.db)
	bare, _ := f.tpl.Create(ctx, f.wid, template.Input{Name: "Gym", AccountID: &f.accA, Amount: -4500})
	sc, err := f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: f.wid, TemplateID: bare.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-04-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	other, _ := f.q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: f.wid, Name: "Someone else"})
	mk := func(date string, payee *int64, tpl int64) int64 {
		tx, err := txns.Create(ctx, f.wid, transaction.Input{AccountID: f.accA, Date: date, Amount: -4500, PayeeID: payee, TemplateID: &tpl})
		if err != nil {
			t.Fatal(err)
		}
		return tx.ID
	}
	a := mk("2026-01-01", nil, bare.ID)
	b := mk("2026-02-01", nil, bare.ID)
	kept := mk("2026-03-01", &other.ID, bare.ID)
	stranger := mk("2026-03-02", nil, f.expenseTemplate(t, -100))

	list, err := f.s.List(ctx, f.wid)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].PayeeID != nil || list[0].WithoutPayee != 2 {
		t.Fatalf("list before: %+v", list)
	}
	if _, err := f.s.ApplyPayee(ctx, f.wid, sc.ID); !errors.Is(err, ErrPayeeRequired) {
		t.Fatalf("apply without a payee: got %v", err)
	}

	gym, _ := f.q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: f.wid, Name: "Gym Co"})
	if _, err := f.tpl.Update(ctx, f.wid, bare.ID, template.Input{Name: "Gym", AccountID: &f.accA, Amount: -4500, PayeeID: &gym.ID}); err != nil {
		t.Fatal(err)
	}
	n, err := f.s.ApplyPayee(ctx, f.wid, sc.ID)
	if err != nil || n != 2 {
		t.Fatalf("apply: n=%d err=%v, want 2", n, err)
	}
	want := map[int64]*int64{a: &gym.ID, b: &gym.ID, kept: &other.ID, stranger: nil}
	for id, p := range want {
		row, _ := f.q.GetTransaction(ctx, id)
		if (p == nil && row.PayeeID.Valid) || (p != nil && row.PayeeID.Int64 != *p) {
			t.Errorf("transaction %d: payee %v, want %v", id, row.PayeeID, p)
		}
	}
	got, _ := f.s.Get(ctx, sc.ID)
	if got.PayeeName != "Gym Co" || got.WithoutPayee != 0 {
		t.Fatalf("get after: %+v", got)
	}
	if _, err := f.s.ApplyPayee(ctx, f.wid+1, sc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other wallet: got %v", err)
	}
}
