package backup

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// counts returns the per-wallet entity counts used to compare two wallets.
func counts(t *testing.T, q *db.Queries, walletID int64) map[string]int {
	t.Helper()
	ctx := context.Background()
	m := map[string]int{}
	curs, _ := q.ListCurrenciesForWallet(ctx, walletID)
	m["currencies"] = len(curs)
	accts, _ := q.ListAccountsForWallet(ctx, walletID)
	m["accounts"] = len(accts)
	pays, _ := q.ListPayeesForWallet(ctx, walletID)
	m["payees"] = len(pays)
	cats, _ := q.ListCategoriesForWallet(ctx, walletID)
	m["categories"] = len(cats)
	tags, _ := q.ListTagsForWallet(ctx, walletID)
	m["tags"] = len(tags)
	tpls, _ := q.ListTemplatesForWallet(ctx, walletID)
	m["templates"] = len(tpls)
	scheds, _ := q.ListSchedulesForWallet(ctx, walletID)
	m["schedules"] = len(scheds)
	asgs, _ := q.ListAssignmentsForWallet(ctx, walletID)
	m["assignments"] = len(asgs)
	budgets, _ := q.ListBudgetsForWallet(ctx, walletID)
	m["budgets"] = len(budgets)
	transfers, _ := q.ListTransfersForWallet(ctx, walletID)
	m["transfers"] = len(transfers)
	txns, splits := 0, 0
	for _, a := range accts {
		rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: a.ID, Limit: 1000, Offset: 0})
		txns += len(rows)
		for _, r := range rows {
			sp, _ := q.ListSplits(ctx, r.ID)
			splits += len(sp)
		}
	}
	m["transactions"] = txns
	m["splits"] = splits
	return m
}

// balancesByName returns future balances keyed by account name.
func balancesByName(t *testing.T, st *store.Store, q *db.Queries, walletID int64) map[string]int64 {
	t.Helper()
	ctx := context.Background()
	txns := transaction.NewService(st.Write())
	accts, _ := q.ListAccountsForWallet(ctx, walletID)
	out := map[string]int64{}
	for _, a := range accts {
		_, summary, err := txns.Register(ctx, a.ID)
		if err != nil {
			t.Fatalf("Register(%s): %v", a.Name, err)
		}
		out[a.Name] = summary.Future
	}
	return out
}

func TestBackupRestoreRoundTrip(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	// Populate a wallet with the importer's golden fixture (covers every entity).
	f, err := os.Open("../importer/testdata/sample.xhb")
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer func() { _ = f.Close() }()
	x, err := importer.ParseXHB(f)
	if err != nil {
		t.Fatalf("ParseXHB: %v", err)
	}
	imp, err := importer.NewService(st.Write()).ImportXHB(ctx, user.ID, x)
	if err != nil {
		t.Fatalf("ImportXHB: %v", err)
	}
	origID := imp.WalletID

	svc := NewService(st.Write())
	doc, err := svc.Export(ctx, origID)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}

	// Round-trip through JSON to simulate a downloaded/uploaded file.
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var restored Document
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	newID, err := svc.Restore(ctx, user.ID, &restored)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if newID == origID {
		t.Fatal("restore must create a new wallet")
	}

	// Identical entity counts.
	origCounts := counts(t, q, origID)
	newCounts := counts(t, q, newID)
	for k, v := range origCounts {
		if newCounts[k] != v {
			t.Fatalf("count[%s] = %d, want %d (orig=%+v new=%+v)", k, newCounts[k], v, origCounts, newCounts)
		}
	}
	// Sanity: the fixture really did exercise every entity type.
	for _, k := range []string{"currencies", "accounts", "payees", "categories", "tags",
		"transactions", "transfers", "templates", "schedules", "assignments", "budgets", "splits"} {
		if origCounts[k] == 0 {
			t.Fatalf("fixture has no %s; round-trip is not meaningfully testing it", k)
		}
	}

	// Identical per-account balances.
	origBal := balancesByName(t, st, q, origID)
	newBal := balancesByName(t, st, q, newID)
	for name, bal := range origBal {
		if newBal[name] != bal {
			t.Fatalf("balance[%s] = %d, want %d", name, newBal[name], bal)
		}
	}
	// And the known golden balances survive.
	want := map[string]int64{"Checking": 19500, "Savings": 7500, "USD Wallet": 20000}
	for name, bal := range want {
		if newBal[name] != bal {
			t.Fatalf("restored balance[%s] = %d, want %d", name, newBal[name], bal)
		}
	}
}

func TestRestoreRejectsUnknownVersion(t *testing.T) {
	st, _ := store.Open(t.TempDir())
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	_, err := NewService(st.Write()).Restore(ctx, user.ID, &Document{Version: 999})
	if err == nil {
		t.Fatal("expected an error for an unsupported version")
	}
}
