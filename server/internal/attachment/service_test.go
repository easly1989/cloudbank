package attachment

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

type fixture struct {
	s   *Service
	dir string
	wid int64
	txn int64
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	a, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	ts := transaction.NewService(st.Write())
	txn, err := ts.Create(ctx, w.ID, transaction.Input{AccountID: a.ID, Date: "2026-01-01", Amount: -1000})
	if err != nil {
		t.Fatalf("create txn: %v", err)
	}
	dir := t.TempDir()
	return fixture{s: NewService(st.Write(), dir), dir: dir, wid: w.ID, txn: txn.ID}
}

func TestCreateListOpenDelete(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	data := []byte("receipt-bytes")

	att, err := f.s.Create(ctx, f.wid, f.txn, "r.png", "image/png", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if att.Size != int64(len(data)) || att.Filename != "r.png" || att.ContentType != "image/png" {
		t.Fatalf("metadata = %+v", att)
	}

	list, err := f.s.List(ctx, f.wid, f.txn)
	if err != nil || len(list) != 1 {
		t.Fatalf("List = %v, %v", list, err)
	}

	meta, file, err := f.s.Open(ctx, f.wid, att.ID)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got, _ := os.ReadFile(file.Name())
	_ = file.Close()
	if meta.ID != att.ID || !bytes.Equal(got, data) {
		t.Fatalf("Open bytes = %q", got)
	}

	if err := f.s.Delete(ctx, f.wid, att.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if list, _ := f.s.List(ctx, f.wid, f.txn); len(list) != 0 {
		t.Fatalf("List after delete = %d", len(list))
	}
	if _, _, err := f.s.Open(ctx, f.wid, att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Open after delete = %v, want ErrNotFound", err)
	}
}

func TestSizeLimitAndEmpty(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.s.maxSize = 4 // shrink for the test

	if _, err := f.s.Create(ctx, f.wid, f.txn, "big.bin", "application/octet-stream", strings.NewReader("12345")); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over-limit = %v, want ErrTooLarge", err)
	}
	if _, err := f.s.Create(ctx, f.wid, f.txn, "empty.bin", "application/octet-stream", strings.NewReader("")); !errors.Is(err, ErrEmpty) {
		t.Fatalf("empty = %v, want ErrEmpty", err)
	}
	// Neither rejected upload leaves a row or a file behind.
	if list, _ := f.s.List(ctx, f.wid, f.txn); len(list) != 0 {
		t.Fatalf("rejected uploads left %d rows", len(list))
	}
	entries, _ := os.ReadDir(f.s.walletDir(f.wid))
	if len(entries) != 0 {
		t.Fatalf("rejected uploads left %d files", len(entries))
	}
}

func TestWalletIsolationAndPurge(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	att, err := f.s.Create(ctx, f.wid, f.txn, "a.txt", "text/plain", strings.NewReader("hi"))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	// A different wallet id cannot read or delete it.
	const otherWallet = 999
	if _, _, err := f.s.Open(ctx, otherWallet, att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-wallet Open = %v", err)
	}
	if err := f.s.Delete(ctx, otherWallet, att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-wallet Delete = %v", err)
	}
	// Creating against a transaction not in the wallet is rejected.
	if _, err := f.s.Create(ctx, otherWallet, f.txn, "x", "text/plain", strings.NewReader("x")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-wallet Create = %v", err)
	}
	// PurgeTransactions removes the on-disk file (rows cascade separately).
	path := f.s.path(f.wid, mustStorageKey(t, f))
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file missing before purge: %v", err)
	}
	if err := f.s.PurgeTransactions(ctx, []int64{f.txn}); err != nil {
		t.Fatalf("PurgeTransactions: %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file still present after purge")
	}
}

// mustStorageKey fetches the single attachment's storage key for path assertions.
func mustStorageKey(t *testing.T, f fixture) string {
	t.Helper()
	rows, err := f.s.q.ListAttachmentsForWallet(context.Background(), f.wid)
	if err != nil || len(rows) != 1 {
		t.Fatalf("ListAttachmentsForWallet = %v, %v", rows, err)
	}
	return rows[0].StorageKey
}
