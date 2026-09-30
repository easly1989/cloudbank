package backup

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/attachment"
	"github.com/easly1989/cloudbank/server/internal/goal"
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
	txns, splits, linked := 0, 0, 0
	for _, a := range accts {
		rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: a.ID, Limit: 1000, Offset: 0})
		txns += len(rows)
		for _, r := range rows {
			if r.TemplateID.Valid {
				linked++
			}
			sp, _ := q.ListSplits(ctx, r.ID)
			splits += len(sp)
		}
	}
	m["transactions"] = txns
	m["splits"] = splits
	m["linked"] = linked
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

	// A transaction a schedule posted keeps its template (#546); a HomeBank
	// file records no such link, so one is made here.
	tpls, _ := q.ListTemplatesForWallet(ctx, origID)
	accts, _ := q.ListAccountsForWallet(ctx, origID)
	rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: accts[0].ID, Limit: 1, Offset: 0})
	if err := q.SetTransactionTemplate(ctx, db.SetTransactionTemplateParams{
		TemplateID: sql.NullInt64{Int64: tpls[0].ID, Valid: true}, ID: rows[0].ID,
	}); err != nil {
		t.Fatal(err)
	}

	// A rule's account condition, info and tags (#566): HomeBank has none of
	// them, so the first rule gets all three here.
	asgs, _ := q.ListAssignmentsForWallet(ctx, origID)
	a0 := asgs[0]
	if err := q.UpdateAssignment(ctx, db.UpdateAssignmentParams{
		MatchField: a0.MatchField, MatchType: a0.MatchType, Pattern: a0.Pattern, CaseSensitive: a0.CaseSensitive,
		MatchAccountID: sql.NullInt64{Int64: accts[0].ID, Valid: true}, SetPayeeID: a0.SetPayeeID,
		SetCategoryID: a0.SetCategoryID, SetPaymentMode: a0.SetPaymentMode,
		SetInfo:       sql.NullString{String: "0042", Valid: true},
		ApplyOnManual: a0.ApplyOnManual, ApplyOnImport: a0.ApplyOnImport, ID: a0.ID,
	}); err != nil {
		t.Fatal(err)
	}
	tag, _ := q.InsertTag(ctx, db.InsertTagParams{WalletID: origID, Name: "rule-tag"})
	if err := q.AddAssignmentTag(ctx, db.AddAssignmentTagParams{AssignmentID: a0.ID, TagID: tag.ID}); err != nil {
		t.Fatal(err)
	}

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
		"transactions", "transfers", "templates", "schedules", "assignments", "budgets", "splits", "linked"} {
		if origCounts[k] == 0 {
			t.Fatalf("fixture has no %s; round-trip is not meaningfully testing it", k)
		}
	}

	// The first rule keeps its account (the restored one of the same name),
	// its info and its tag.
	newAsgs, _ := q.ListAssignmentsForWallet(ctx, newID)
	newAccts, _ := q.ListAccountsForWallet(ctx, newID)
	var sameAcc int64
	for _, a := range newAccts {
		if a.Name == accts[0].Name {
			sameAcc = a.ID
		}
	}
	n0 := newAsgs[0]
	if !n0.MatchAccountID.Valid || n0.MatchAccountID.Int64 != sameAcc || n0.SetInfo.String != "0042" {
		t.Fatalf("restored rule = account %v info %v, want %d and 0042", n0.MatchAccountID, n0.SetInfo, sameAcc)
	}
	ruleTags, _ := q.ListAssignmentTagsForWallet(ctx, newID)
	if len(ruleTags) != 1 || ruleTags[0].AssignmentID != n0.ID || ruleTags[0].Name != "rule-tag" {
		t.Fatalf("restored rule tags = %+v", ruleTags)
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

// TestBackupRestoreAttachments verifies attachment metadata and file bytes
// survive an export → JSON → restore cycle into a fresh wallet.
func TestBackupRestoreAttachments(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	ts := transaction.NewService(st.Write())
	txn, err := ts.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: "2026-01-01", Amount: -1000})
	if err != nil {
		t.Fatalf("create txn: %v", err)
	}

	att := attachment.NewService(st.Write(), t.TempDir())
	content := []byte("PDF-bytes-\x00\x01\x02 receipt")
	if _, err := att.Create(ctx, w.ID, txn.ID, "receipt.pdf", "application/pdf", bytes.NewReader(content)); err != nil {
		t.Fatalf("create attachment: %v", err)
	}

	svc := NewService(st.Write())
	svc.SetAttachments(att)
	doc, err := svc.Export(ctx, w.ID)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if len(doc.Attachments) != 1 || doc.Attachments[0].Filename != "receipt.pdf" ||
		doc.Attachments[0].Size != int64(len(content)) {
		t.Fatalf("exported attachments = %+v", doc.Attachments)
	}

	data, _ := json.Marshal(doc)
	var restored Document
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	newID, err := svc.Restore(ctx, user.ID, &restored)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}

	rows, err := q.ListAttachmentsForWallet(ctx, newID)
	if err != nil {
		t.Fatalf("list restored attachments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("restored attachments = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.Filename != "receipt.pdf" || r.ContentType != "application/pdf" || r.Size != int64(len(content)) || r.WalletID != newID {
		t.Fatalf("restored metadata = %+v", r)
	}
	got, err := att.Bytes(newID, r.StorageKey)
	if err != nil {
		t.Fatalf("read restored file: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("restored bytes differ: %q vs %q", got, content)
	}
}

// TestBackupRestoreGoals verifies savings goals and their signed contributions
// survive an export → JSON → restore cycle, with the optional linked account
// remapped to the restored wallet.
func TestBackupRestoreGoals(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Savings", Type: "savings", CurrencyID: cur.ID, Position: 1,
	})

	gs := goal.NewService(st.Write())
	date := "2026-12-31"
	g, err := gs.Create(ctx, w.ID, goal.Input{
		Name: "New laptop", TargetAmount: 150000, TargetDate: &date, AccountID: &acc.ID, Note: "for work",
	})
	if err != nil {
		t.Fatalf("create goal: %v", err)
	}
	if _, err := gs.AddContribution(ctx, w.ID, g.ID, "2026-02-01", 60000, "first"); err != nil {
		t.Fatalf("add contribution: %v", err)
	}
	if _, err := gs.AddContribution(ctx, w.ID, g.ID, "2026-03-01", -10000, "oops"); err != nil {
		t.Fatalf("withdraw contribution: %v", err)
	}

	svc := NewService(st.Write())
	doc, err := svc.Export(ctx, w.ID)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if len(doc.Goals) != 1 || len(doc.Goals[0].Contributions) != 2 {
		t.Fatalf("exported goals = %+v", doc.Goals)
	}

	data, _ := json.Marshal(doc)
	var restored Document
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	newID, err := svc.Restore(ctx, user.ID, &restored)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}

	goals, err := gs.List(ctx, newID)
	if err != nil {
		t.Fatalf("list restored goals: %v", err)
	}
	if len(goals) != 1 {
		t.Fatalf("restored goals = %d, want 1", len(goals))
	}
	rg := goals[0]
	if rg.Name != "New laptop" || rg.TargetAmount != 150000 || rg.Note != "for work" {
		t.Fatalf("restored goal = %+v", rg)
	}
	if rg.TargetDate == nil || *rg.TargetDate != date {
		t.Fatalf("restored targetDate = %v, want %s", rg.TargetDate, date)
	}
	// Saved total = 60000 − 10000: both contributions survived with their signs.
	if rg.Saved != 50000 {
		t.Fatalf("restored saved = %d, want 50000", rg.Saved)
	}
	// The optional linked account was remapped into the new wallet.
	newAccts, _ := q.ListAccountsForWallet(ctx, newID)
	if len(newAccts) != 1 || rg.AccountID == nil || *rg.AccountID != newAccts[0].ID {
		t.Fatalf("restored accountId = %v, new accounts = %+v", rg.AccountID, newAccts)
	}
	contribs, err := gs.Contributions(ctx, newID, rg.ID)
	if err != nil {
		t.Fatalf("list restored contributions: %v", err)
	}
	if len(contribs) != 2 {
		t.Fatalf("restored contributions = %d, want 2", len(contribs))
	}
}

// A vehicle and each transaction's link to it survive a round trip (#528): the
// backup used to leave both out, so the restored wallet's vehicle report was empty.
func TestBackupRestoreVehicles(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "bank", CurrencyID: cur.ID, Position: 1,
	})
	car, err := q.InsertVehicle(ctx, db.InsertVehicleParams{WalletID: w.ID, Name: "Car", Plate: "AB123CD", Notes: "blue"})
	if err != nil {
		t.Fatalf("insert vehicle: %v", err)
	}
	if _, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: w.ID, AccountID: acc.ID, Date: "2026-09-01", Amount: -5000, Memo: "d=1000 v=30",
		VehicleID: sql.NullInt64{Int64: car.ID, Valid: true},
	}); err != nil {
		t.Fatalf("insert fuel: %v", err)
	}
	if _, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: w.ID, AccountID: acc.ID, Date: "2026-09-02", Amount: -300, Memo: "coffee",
	}); err != nil {
		t.Fatalf("insert coffee: %v", err)
	}

	svc := NewService(st.Write())
	doc, err := svc.Export(ctx, w.ID)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	data, _ := json.Marshal(doc)
	var restored Document
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	newID, err := svc.Restore(ctx, user.ID, &restored)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}

	vehicles, _ := q.ListVehiclesForWallet(ctx, newID)
	if len(vehicles) != 1 || vehicles[0].Name != "Car" || vehicles[0].Plate != "AB123CD" || vehicles[0].Notes != "blue" {
		t.Fatalf("restored vehicles = %+v", vehicles)
	}
	newAccts, _ := q.ListAccountsForWallet(ctx, newID)
	rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{
		AccountID: newAccts[0].ID, Limit: 10,
	})
	linked := map[string]sql.NullInt64{}
	for _, r := range rows {
		linked[r.Memo] = r.VehicleID
	}
	if v := linked["d=1000 v=30"]; !v.Valid || v.Int64 != vehicles[0].ID {
		t.Fatalf("fuel transaction vehicle = %+v, want %d", v, vehicles[0].ID)
	}
	if v := linked["coffee"]; v.Valid {
		t.Fatalf("coffee has a vehicle: %+v", v)
	}
}

// A backup written before vehicles were included still restores.
func TestRestoreBackupWithoutVehicles(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	user, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	old := `{"version":1,"wallet":{"title":"Old"},
	  "currencies":[{"id":1,"isoCode":"EUR","name":"Euro","symbol":"€","decimalChar":",","groupChar":".","fracDigits":2,"isBase":true,"rate":1}],
	  "accounts":[{"id":1,"name":"Checking","type":"bank","currencyId":1}],
	  "transactions":[{"id":1,"accountId":1,"date":"2026-09-01","amount":-5000,"memo":"fuel"}]}`
	var doc Document
	if err := json.Unmarshal([]byte(old), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	newID, err := NewService(st.Write()).Restore(ctx, user.ID, &doc)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if vs, _ := q.ListVehiclesForWallet(ctx, newID); len(vs) != 0 {
		t.Fatalf("vehicles = %+v, want none", vs)
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
