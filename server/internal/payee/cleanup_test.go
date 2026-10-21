package payee

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func TestCleanupAndUndo(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	raw := st.Write()
	q := db.New(raw)
	s := NewService(raw)
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	shopping, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Shopping"})
	food, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Food"})

	pay := func(name string, cat *int64) int64 {
		p, err := s.Create(ctx, w.ID, name, cat, nil)
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	txn := func(payee int64) int64 {
		r, err := raw.ExecContext(ctx, `INSERT INTO transactions (wallet_id, account_id, date, amount, payee_id) VALUES (?, ?, '2026-10-01', -100, ?)`, w.ID, acc.ID, payee)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := r.LastInsertId()
		return id
	}
	amzn1, amzn2 := pay("AMZN MKTP IT*2K3", nil), pay("AMZN MKTP IT*7H1", &shopping.ID)
	superA, super := pay("SUPERMARKET 0423", nil), pay("Supermarket", nil)
	netflix := pay("NETFLIX.COM 866", nil)
	t1, t2, t2b, t3 := txn(amzn1), txn(amzn2), txn(amzn2), txn(superA)
	tpl, _ := q.InsertTemplate(ctx, db.InsertTemplateParams{WalletID: w.ID, Name: "T", PayeeID: sql.NullInt64{Int64: amzn2, Valid: true}})
	rule, _ := q.InsertAssignment(ctx, db.InsertAssignmentParams{WalletID: w.ID, MatchField: "memo", MatchType: "contains", Pattern: "x", SetPayeeID: sql.NullInt64{Int64: superA, Valid: true}, ApplyOnManual: 1, ApplyOnImport: 1})
	if err := q.InsertRecurringIgnored(ctx, db.InsertRecurringIgnoredParams{WalletID: w.ID, PayeeID: amzn2, Cadence: "monthly"}); err != nil {
		t.Fatal(err)
	}
	payeeOf := func(table string, id int64) int64 {
		var p sql.NullInt64
		col := "payee_id"
		if table == "assignments" {
			col = "set_payee_id"
		}
		if err := raw.QueryRowContext(ctx, "SELECT "+col+" FROM "+table+" WHERE id = ?", id).Scan(&p); err != nil {
			t.Fatal(err)
		}
		return p.Int64
	}

	// A payee in two groups, an empty name, a payee of no wallet: refused.
	for _, bad := range [][]CleanupGroup{
		{{Name: "Amazon", PayeeIDs: []int64{amzn1}}, {Name: "Other", PayeeIDs: []int64{amzn1}}},
		{{Name: " ", PayeeIDs: []int64{amzn1}}},
		{{Name: "Amazon", PayeeIDs: []int64{999}}},
	} {
		if _, err := s.Cleanup(ctx, w.ID, bad); !errors.Is(err, ErrBadCleanup) {
			t.Fatalf("cleanup %+v = %v, want ErrBadCleanup", bad, err)
		}
	}

	sum, err := s.Cleanup(ctx, w.ID, []CleanupGroup{
		{Name: "Amazon", PayeeIDs: []int64{amzn1, amzn2}, Rule: "AMZN MKTP"}, // amzn1 becomes Amazon
		{Name: "supermarket", PayeeIDs: []int64{superA}},                     // into the existing one
		{Name: "Netflix", PayeeIDs: []int64{netflix}},                        // a rename
	})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Payees != 3 || sum.Names != 4 || sum.Rules != 1 || sum.CreatedAt == "" {
		t.Fatalf("summary = %+v", sum)
	}
	a, _ := s.Get(ctx, amzn1)
	if a.Name != "Amazon" || a.DefaultCategoryID == nil || *a.DefaultCategoryID != shopping.ID {
		t.Fatalf("amazon = %+v, want the merged payee's default category", a)
	}
	for _, gone := range []int64{amzn2, superA} {
		if _, err := s.Get(ctx, gone); err != ErrNotFound {
			t.Fatalf("payee %d still there", gone)
		}
	}
	if n, _ := s.Get(ctx, netflix); n.Name != "Netflix" {
		t.Fatalf("netflix = %q", n.Name)
	}
	if payeeOf("transactions", t2) != amzn1 || payeeOf("transactions", t3) != super ||
		payeeOf("templates", tpl.ID) != amzn1 || payeeOf("assignments", rule.ID) != super {
		t.Fatal("the merged payees' transactions, template and rule did not follow")
	}
	rules, _ := q.ListAssignmentsForWallet(ctx, w.ID)
	if len(rules) != 2 || rules[1].Pattern != "AMZN MKTP" || rules[1].MatchField != "payee" || rules[1].SetPayeeID.Int64 != amzn1 {
		t.Fatalf("rules = %+v", rules)
	}
	if last, err := s.LastCleanup(ctx, w.ID); err != nil || last.Payees != 3 {
		t.Fatalf("last = %+v, %v", last, err)
	}

	// A transaction added since stays on the clean payee after the undo.
	later := txn(amzn1)
	if err := s.UndoCleanup(ctx, w.ID); err != nil {
		t.Fatal(err)
	}
	for id, name := range map[int64]string{amzn1: "AMZN MKTP IT*2K3", amzn2: "AMZN MKTP IT*7H1", superA: "SUPERMARKET 0423", netflix: "NETFLIX.COM 866"} {
		if p, err := s.Get(ctx, id); err != nil || p.Name != name {
			t.Fatalf("payee %d = %+v, %v; want %q", id, p, err, name)
		}
	}
	if a, _ = s.Get(ctx, amzn1); a.DefaultCategoryID != nil {
		t.Fatal("amazon kept the default category it took")
	}
	if payeeOf("transactions", t1) != amzn1 || payeeOf("transactions", t2) != amzn2 || payeeOf("transactions", t2b) != amzn2 ||
		payeeOf("transactions", t3) != superA || payeeOf("transactions", later) != amzn1 ||
		payeeOf("templates", tpl.ID) != amzn2 || payeeOf("assignments", rule.ID) != superA {
		t.Fatal("the undo did not put the links back")
	}
	if c, _ := q.ListRecurringIgnoredForPayee(ctx, amzn2); len(c) != 1 || c[0] != "monthly" {
		t.Fatalf("ignored recurring = %v", c)
	}
	if rules, _ = q.ListAssignmentsForWallet(ctx, w.ID); len(rules) != 1 {
		t.Fatalf("the cleanup's rule is still there: %+v", rules)
	}
	if err := s.UndoCleanup(ctx, w.ID); !errors.Is(err, ErrNoCleanup) {
		t.Fatalf("second undo = %v, want ErrNoCleanup", err)
	}
	_ = food
}
