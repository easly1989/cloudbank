package exporter

import (
	"bytes"
	"context"
	"os"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/backup"
	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// TestExportImportRoundTrip imports the golden fixture, exports the wallet to
// .xhb, re-imports it, and asserts the entity counts and per-account balances
// survive the round-trip unchanged.
func TestExportImportRoundTrip(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	user, _ := db.New(st.Write()).CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	f, err := os.Open("../importer/testdata/sample.xhb")
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer func() { _ = f.Close() }()
	x, err := importer.ParseXHB(f)
	if err != nil {
		t.Fatalf("ParseXHB: %v", err)
	}
	imp := importer.NewService(st.Write())
	resA, err := imp.ImportXHB(ctx, user.ID, x)
	if err != nil {
		t.Fatalf("import A: %v", err)
	}

	bk := backup.NewService(st.Write())
	docA, err := bk.Export(ctx, resA.WalletID)
	if err != nil {
		t.Fatalf("export A: %v", err)
	}

	data, err := Build(docA)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	x2, err := importer.ParseXHB(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("ParseXHB(exported): %v\n%s", err, data)
	}
	resB, err := imp.ImportXHB(ctx, user.ID, x2)
	if err != nil {
		t.Fatalf("import B: %v", err)
	}
	docB, err := bk.Export(ctx, resB.WalletID)
	if err != nil {
		t.Fatalf("export B: %v", err)
	}

	for name, a := range countsOf(docA) {
		if b := countsOf(docB)[name]; b != a {
			t.Fatalf("count[%s]: original %d, round-tripped %d", name, a, b)
		}
	}
	balA, balB := balanceByName(docA), balanceByName(docB)
	for name, a := range balA {
		if balB[name] != a {
			t.Fatalf("balance[%s]: original %d, round-tripped %d", name, a, balB[name])
		}
	}
	// Sanity: the fixture really did carry data through both hops.
	if len(docB.Transactions) != 5 || len(docB.Transfers) != 1 {
		t.Fatalf("unexpected round-tripped data: %d txns, %d transfers", len(docB.Transactions), len(docB.Transfers))
	}
}

func countsOf(doc *backup.Document) map[string]int {
	return map[string]int{
		"currencies": len(doc.Currencies), "accounts": len(doc.Accounts), "payees": len(doc.Payees),
		"categories": len(doc.Categories), "tags": len(doc.Tags), "transactions": len(doc.Transactions),
		"transfers": len(doc.Transfers), "templates": len(doc.Templates), "schedules": len(doc.Schedules),
		"assignments": len(doc.Assignments), "budgets": len(doc.Budgets),
	}
}

func balanceByName(doc *backup.Document) map[string]int64 {
	nameByID := make(map[int64]string, len(doc.Accounts))
	bal := make(map[string]int64, len(doc.Accounts))
	for _, a := range doc.Accounts {
		nameByID[a.ID] = a.Name
		bal[a.Name] = a.InitialBalance
	}
	for _, tx := range doc.Transactions {
		bal[nameByID[tx.AccountID]] += tx.Amount
	}
	return bal
}
