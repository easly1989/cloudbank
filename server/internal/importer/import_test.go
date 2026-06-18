package importer

import (
	"context"
	"os"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// TestImportGoldenFile imports a fixture .xhb and asserts the entity counts and
// per-account final balances exactly (the HomeBank-parity acceptance).
func TestImportGoldenFile(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	f, err := os.Open("testdata/sample.xhb")
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer func() { _ = f.Close() }()
	x, err := ParseXHB(f)
	if err != nil {
		t.Fatalf("ParseXHB: %v", err)
	}

	res, err := NewService(st.Write()).ImportXHB(ctx, user.ID, x)
	if err != nil {
		t.Fatalf("ImportXHB: %v", err)
	}

	wantCounts := map[string]int{
		"currencies": 2, "accounts": 3, "payees": 1, "categories": 3, "tags": 1,
		"transactions": 5, "transfers": 1, "budgets": 1, "assignments": 1, "templates": 2, "schedules": 1,
	}
	for k, want := range wantCounts {
		if res.Counts[k] != want {
			t.Fatalf("count[%s] = %d, want %d (all=%+v)", k, res.Counts[k], want, res.Counts)
		}
	}

	// Per-account final balances must equal initial + transactions exactly.
	accounts, _ := q.ListAccountsForWallet(ctx, res.WalletID)
	wantBalance := map[string]int64{
		"Checking":   19500, // 10000 -5000 -3000 +20000 -2500
		"Savings":    7500,  // 5000 +2500
		"USD Wallet": 20000, // initial only
	}
	txns := transaction.NewService(st.Write())
	for _, a := range accounts {
		_, summary, err := txns.Register(ctx, a.ID)
		if err != nil {
			t.Fatalf("Register(%s): %v", a.Name, err)
		}
		if want, ok := wantBalance[a.Name]; ok && summary.Future != want {
			t.Fatalf("balance[%s] = %d, want %d", a.Name, summary.Future, want)
		}
	}

	// Budget value parsed in base currency (Food b0 = -100.00).
	budgets, _ := q.ListBudgetsForWallet(ctx, res.WalletID)
	if len(budgets) != 1 || budgets[0].Amount != -10000 {
		t.Fatalf("budgets = %+v", budgets)
	}

	// The split transaction has two split lines.
	var splitTxn int64
	for _, a := range accounts {
		rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: a.ID, Limit: 50})
		for _, r := range rows {
			if r.IsSplit != 0 {
				splitTxn = r.ID
			}
		}
	}
	if splits, _ := q.ListSplits(ctx, splitTxn); len(splits) != 2 {
		t.Fatalf("split lines = %d, want 2", len(splits))
	}

	if len(res.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", res.Warnings)
	}
}

func TestImportVersionWarning(t *testing.T) {
	st, _ := store.Open(t.TempDir())
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	x := &XHB{Version: "2.0", Properties: XProperties{Title: "Future", Curr: 1},
		Currencies: []XCur{{Key: 1, ISO: "EUR", Frac: 2}}}
	res, err := NewService(st.Write()).ImportXHB(ctx, user.ID, x)
	if err != nil {
		t.Fatalf("ImportXHB: %v", err)
	}
	if len(res.Warnings) == 0 {
		t.Fatalf("expected a version warning")
	}
}
