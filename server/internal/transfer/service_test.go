package transfer

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/transaction"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// fixture builds a wallet with two EUR accounts and the transfer service.
type fixture struct {
	s      *Service
	q      *db.Queries
	write  *sql.DB
	wallet int64
	accA   int64
	accB   int64
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
	w, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	cur := insertCurrency(t, q, w.ID, "EUR", 1)
	return fixture{
		s:      NewService(st.Write()),
		q:      q,
		write:  st.Write(),
		wallet: w.ID,
		accA:   insertAccount(t, q, w.ID, "A", cur),
		accB:   insertAccount(t, q, w.ID, "B", cur),
	}
}

func insertCurrency(t *testing.T, q *db.Queries, wallet int64, code string, base int64) int64 {
	t.Helper()
	c, err := q.InsertCurrency(context.Background(), db.InsertCurrencyParams{
		WalletID: wallet, IsoCode: code, Name: code, Symbol: code,
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: base, Rate: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func insertAccount(t *testing.T, q *db.Queries, wallet int64, name string, cur int64) int64 {
	t.Helper()
	a, err := q.InsertAccount(context.Background(), db.InsertAccountParams{
		WalletID: wallet, Name: name, Type: "checking", CurrencyID: cur, Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a.ID
}

func TestCreateMakesTwoLinkedLegs(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tr, err := f.s.Create(ctx, f.wallet, Input{
		FromAccountID: f.accA, ToAccountID: f.accB, Date: "2026-01-15",
		FromAmount: 5000, Memo: "rent", Status: transaction.StatusCleared,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if tr.FromAmount != 5000 || tr.ToAmount != 5000 {
		t.Fatalf("amounts = %d/%d, want 5000/5000", tr.FromAmount, tr.ToAmount)
	}
	from, _ := f.q.GetTransaction(ctx, tr.TxnFromID)
	to, _ := f.q.GetTransaction(ctx, tr.TxnToID)
	if from.Amount != -5000 || from.AccountID != f.accA || from.PaymentMode != paymodeInternalTransfer {
		t.Fatalf("from leg = %+v", from)
	}
	if to.Amount != 5000 || to.AccountID != f.accB || to.PaymentMode != paymodeInternalTransfer {
		t.Fatalf("to leg = %+v", to)
	}
	if from.Date != "2026-01-15" || to.Date != "2026-01-15" {
		t.Fatalf("dates = %q/%q", from.Date, to.Date)
	}
	// Round-trips through Get.
	got, err := f.s.Get(ctx, f.wallet, tr.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.FromAccountID != f.accA || got.ToAccountID != f.accB || got.FromAmount != 5000 || got.ToAmount != 5000 {
		t.Fatalf("Get = %+v", got)
	}
}

func TestCrossCurrency(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	usd := insertCurrency(t, f.q, f.wallet, "USD", 0)
	accUSD := insertAccount(t, f.q, f.wallet, "USD", usd)

	tr, err := f.s.Create(ctx, f.wallet, Input{
		FromAccountID: f.accA, ToAccountID: accUSD, Date: "2026-01-15",
		FromAmount: 10000, ToAmount: 11000,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	from, _ := f.q.GetTransaction(ctx, tr.TxnFromID)
	to, _ := f.q.GetTransaction(ctx, tr.TxnToID)
	if from.Amount != -10000 || to.Amount != 11000 {
		t.Fatalf("cross-currency legs = %d/%d, want -10000/11000", from.Amount, to.Amount)
	}
}

// Deleting either leg through the transaction service removes both legs and the
// transfers row (the no-orphan-legs invariant).
func TestDeleteViaTransactionPathRemovesBothLegs(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	txnSvc := transaction.NewService(f.write)
	tr, err := f.s.Create(ctx, f.wallet, Input{
		FromAccountID: f.accA, ToAccountID: f.accB, Date: "2026-01-15", FromAmount: 5000,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Delete the *to* leg; the *from* leg must vanish too.
	if err := txnSvc.Delete(ctx, tr.TxnToID); err != nil {
		t.Fatalf("Delete leg: %v", err)
	}
	if _, err := f.q.GetTransaction(ctx, tr.TxnFromID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("from leg still present: %v", err)
	}
	if _, err := f.q.GetTransaction(ctx, tr.TxnToID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("to leg still present: %v", err)
	}
	if _, err := f.q.GetTransfer(ctx, tr.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("transfer row still present: %v", err)
	}
}

func TestServiceDeleteRemovesBothLegs(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tr, _ := f.s.Create(ctx, f.wallet, Input{
		FromAccountID: f.accA, ToAccountID: f.accB, Date: "2026-01-15", FromAmount: 5000,
	})
	if err := f.s.Delete(ctx, f.wallet, tr.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := f.q.GetTransaction(ctx, tr.TxnFromID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("from leg still present")
	}
	if _, err := f.q.GetTransaction(ctx, tr.TxnToID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("to leg still present")
	}
}

// Update syncs date and amounts on both legs but leaves each leg's own
// reconciliation status untouched.
func TestUpdateSyncsAmountNotStatus(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tr, _ := f.s.Create(ctx, f.wallet, Input{
		FromAccountID: f.accA, ToAccountID: f.accB, Date: "2026-01-15",
		FromAmount: 5000, Status: transaction.StatusCleared,
	})
	// Reconcile only the *to* leg, directly.
	to, _ := f.q.GetTransaction(ctx, tr.TxnToID)
	if err := f.q.UpdateTransaction(ctx, db.UpdateTransactionParams{
		Date: to.Date, Amount: to.Amount, PaymentMode: to.PaymentMode,
		Status: transaction.StatusReconciled, Info: to.Info, PayeeID: to.PayeeID,
		CategoryID: to.CategoryID, Memo: to.Memo, IsSplit: to.IsSplit, ID: to.ID,
	}); err != nil {
		t.Fatalf("reconcile to leg: %v", err)
	}

	if _, err := f.s.Update(ctx, f.wallet, tr.ID, Input{Date: "2026-02-01", FromAmount: 7000}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	from, _ := f.q.GetTransaction(ctx, tr.TxnFromID)
	to, _ = f.q.GetTransaction(ctx, tr.TxnToID)
	if from.Date != "2026-02-01" || from.Amount != -7000 || to.Amount != 7000 {
		t.Fatalf("legs after update: from=%+v to=%+v", from, to)
	}
	if int(from.Status) != transaction.StatusCleared {
		t.Fatalf("from status = %d, want cleared", from.Status)
	}
	if int(to.Status) != transaction.StatusReconciled {
		t.Fatalf("to status = %d, want reconciled (preserved)", to.Status)
	}
}

func TestValidation(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	base := Input{FromAccountID: f.accA, ToAccountID: f.accB, Date: "2026-01-15", FromAmount: 100}

	bad := base
	bad.ToAccountID = f.accA
	if _, err := f.s.Create(ctx, f.wallet, bad); !errors.Is(err, ErrSameAccount) {
		t.Fatalf("same account = %v", err)
	}
	bad = base
	bad.ToAccountID = 9999
	if _, err := f.s.Create(ctx, f.wallet, bad); !errors.Is(err, ErrInvalidAccount) {
		t.Fatalf("foreign account = %v", err)
	}
	bad = base
	bad.FromAmount = 0
	if _, err := f.s.Create(ctx, f.wallet, bad); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("zero amount = %v", err)
	}
}

func TestGetWrongWalletIsolation(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	other, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	tr, _ := f.s.Create(ctx, f.wallet, Input{
		FromAccountID: f.accA, ToAccountID: f.accB, Date: "2026-01-15", FromAmount: 5000,
	})
	if _, err := f.s.Get(ctx, other.ID, tr.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-wallet Get = %v, want ErrNotFound", err)
	}
}
