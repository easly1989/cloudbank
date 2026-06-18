package csvio

import (
	"context"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func newTestService(t *testing.T) (*Service, *transaction.Service, *assignment.Service, *db.Queries, int64, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	cur, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "bank", CurrencyID: cur.ID, Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	txn := transaction.NewService(st.Write())
	rules := assignment.NewService(st.Write())
	accts := account.NewService(st.Write())
	return NewService(st.Write(), txn, rules, accts), txn, rules, q, w.ID, acc.ID
}

const sampleCSV = "2026-01-15;3;ref;Grocer;shop;-12.34;Food:Groceries;food cash\n" +
	"2026-01-16;0;;Employer;salary;2000.00;Salary;\n"

func TestPreviewAndCommit(t *testing.T) {
	s, txn, _, q, wid, acc := newTestService(t)
	ctx := context.Background()

	pv, err := s.Preview(ctx, wid, PreviewRequest{AccountID: acc, Content: sampleCSV, Dialect: DialectHomeBank})
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if len(pv.Rows) != 2 {
		t.Fatalf("preview rows = %d", len(pv.Rows))
	}
	if pv.Rows[0].Amount != -1234 || pv.Rows[1].Amount != 200000 {
		t.Fatalf("amounts = %d, %d", pv.Rows[0].Amount, pv.Rows[1].Amount)
	}
	for _, r := range pv.Rows {
		if !r.Include || r.Duplicate {
			t.Fatalf("row should be included, not duplicate: %+v", r)
		}
	}

	rows := make([]CommitRow, 0, len(pv.Rows))
	for _, r := range pv.Rows {
		rows = append(rows, CommitRow{
			Date: r.Date, Amount: r.Amount, PaymentMode: r.PaymentMode, Info: r.Info,
			Payee: r.Payee, Memo: r.Memo, Category: r.Category, Tags: r.Tags,
		})
	}
	res, err := s.Commit(ctx, wid, acc, rows)
	if err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if res.Created != 2 {
		t.Fatalf("created = %d, want 2", res.Created)
	}

	// Payee "Grocer" created.
	pays, _ := q.ListPayeesForWallet(ctx, wid)
	if len(pays) != 2 {
		t.Fatalf("payees = %d, want 2 (Grocer, Employer)", len(pays))
	}
	// Category Food → Groceries created as a two-level pair, plus Salary.
	cats, _ := q.ListCategoriesForWallet(ctx, wid)
	var haveFood, haveGroceriesUnderFood bool
	byID := map[int64]db.Category{}
	for _, c := range cats {
		byID[c.ID] = c
	}
	for _, c := range cats {
		if c.Name == "Food" && !c.ParentID.Valid {
			haveFood = true
		}
		if c.Name == "Groceries" && c.ParentID.Valid && byID[c.ParentID.Int64].Name == "Food" {
			haveGroceriesUnderFood = true
		}
	}
	if !haveFood || !haveGroceriesUnderFood {
		t.Fatalf("categories not created two-level: %+v", cats)
	}

	// The expense transaction carries its two tags.
	list, _, _ := txn.List(ctx, acc, 50, 0)
	if len(list) != 2 {
		t.Fatalf("transactions = %d", len(list))
	}
	var tagged int64
	for _, tr := range list {
		if tr.Amount == -1234 {
			tagged = tr.ID
		}
	}
	tags, _ := q.ListTransactionTags(ctx, tagged)
	if len(tags) != 2 {
		t.Fatalf("tags = %v, want 2", tags)
	}
}

func TestPreviewFlagsDuplicates(t *testing.T) {
	s, txn, _, _, wid, acc := newTestService(t)
	ctx := context.Background()
	// Pre-existing transaction matching the first CSV row (same date + amount).
	if _, err := txn.Create(ctx, wid, transaction.Input{
		AccountID: acc, Date: "2026-01-15", Amount: -1234, Memo: "earlier",
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	pv, err := s.Preview(ctx, wid, PreviewRequest{AccountID: acc, Content: sampleCSV, Dialect: DialectHomeBank})
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if !pv.Rows[0].Duplicate || pv.Rows[0].Include {
		t.Fatalf("row 0 should be a flagged (excluded) duplicate: %+v", pv.Rows[0])
	}
	if pv.Rows[1].Duplicate {
		t.Fatalf("row 1 should not be a duplicate: %+v", pv.Rows[1])
	}
}

func TestPreviewAppliesImportRules(t *testing.T) {
	s, _, rules, q, wid, acc := newTestService(t)
	ctx := context.Background()
	auto, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Auto"})
	mode := 4
	if _, err := rules.Create(ctx, wid, assignment.Input{
		MatchField: assignment.FieldMemo, MatchType: assignment.TypeContains, Pattern: "fuel",
		SetCategoryID: &auto.ID, SetPaymentMode: &mode, ApplyOnImport: true,
	}); err != nil {
		t.Fatalf("rule: %v", err)
	}

	content := "2026-02-01;0;;Shell;fuel up;-50.00;;\n"
	pv, err := s.Preview(ctx, wid, PreviewRequest{
		AccountID: acc, Content: content, Dialect: DialectHomeBank, ApplyRules: true,
	})
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	r := pv.Rows[0]
	if !r.RuleApplied || r.Category != "Auto" || r.PaymentMode != 4 {
		t.Fatalf("rule not applied: %+v", r)
	}
}

func TestExportRoundTrip(t *testing.T) {
	s, _, _, _, wid, acc := newTestService(t)
	ctx := context.Background()

	pv, _ := s.Preview(ctx, wid, PreviewRequest{AccountID: acc, Content: sampleCSV, Dialect: DialectHomeBank})
	rows := make([]CommitRow, 0, len(pv.Rows))
	for _, r := range pv.Rows {
		rows = append(rows, CommitRow{
			Date: r.Date, Amount: r.Amount, PaymentMode: r.PaymentMode, Info: r.Info,
			Payee: r.Payee, Memo: r.Memo, Category: r.Category, Tags: r.Tags,
		})
	}
	if _, err := s.Commit(ctx, wid, acc, rows); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	out, err := s.ExportAccount(ctx, wid, acc)
	if err != nil {
		t.Fatalf("ExportAccount: %v", err)
	}
	if !strings.Contains(out, "Food:Groceries") || !strings.Contains(out, "Grocer") {
		t.Fatalf("export missing data:\n%s", out)
	}
	reparsed, err := Parse(out, ParseOptions{Dialect: DialectHomeBank})
	if err != nil {
		t.Fatalf("re-Parse export: %v", err)
	}
	if len(reparsed) != 2 {
		t.Fatalf("re-parsed rows = %d, want 2", len(reparsed))
	}
	// Oldest-first; the -12.34 expense (Jan 15) sorts before salary (Jan 16).
	if rescaleAmount(reparsed[0].Amount, 2) != -1234 || reparsed[0].Category != "Food:Groceries" {
		t.Fatalf("round-trip row0 = %+v", reparsed[0])
	}
}
