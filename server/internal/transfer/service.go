// Package transfer manages internal transfers: two linked transactions (a
// negative leg in the source account and a positive leg in the destination)
// kept in sync, with cross-currency support.
package transfer

import (
	"context"
	"database/sql"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// paymodeInternalTransfer is HomeBank PAYMODE 5.
const paymodeInternalTransfer = 5

// Sentinel errors.
var (
	ErrNotFound       = errors.New("transfer: not found")
	ErrSameAccount    = errors.New("transfer: source and destination must differ")
	ErrInvalidAccount = errors.New("transfer: account does not belong to the wallet")
	ErrInvalidAmount  = errors.New("transfer: amounts must be greater than zero")
)

// Transfer is the public representation of a transfer. Amounts are positive
// magnitudes in each leg's account currency.
type Transfer struct {
	ID            int64  `json:"id"`
	FromAccountID int64  `json:"fromAccountId"`
	ToAccountID   int64  `json:"toAccountId"`
	Date          string `json:"date"`
	FromAmount    int64  `json:"fromAmount"`
	ToAmount      int64  `json:"toAmount"`
	Memo          string `json:"memo"`
	Status        int    `json:"status"`
	TxnFromID     int64  `json:"txnFromId"`
	TxnToID       int64  `json:"txnToId"`
}

// Input carries the editable fields of a transfer (positive magnitudes).
type Input struct {
	FromAccountID int64
	ToAccountID   int64
	Date          string
	FromAmount    int64
	ToAmount      int64 // 0 → same as FromAmount (same-currency transfer)
	Memo          string
	Status        int
}

// Service implements transfer management.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

func (s *Service) validate(ctx context.Context, walletID int64, in *Input) error {
	if in.FromAccountID == in.ToAccountID {
		return ErrSameAccount
	}
	for _, id := range []int64{in.FromAccountID, in.ToAccountID} {
		acc, err := s.q.GetAccount(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && acc.WalletID != walletID) {
			return ErrInvalidAccount
		}
		if err != nil {
			return err
		}
	}
	if in.ToAmount == 0 {
		in.ToAmount = in.FromAmount
	}
	if in.FromAmount <= 0 || in.ToAmount <= 0 {
		return ErrInvalidAmount
	}
	return nil
}

func (s *Service) insertLeg(ctx context.Context, qtx *db.Queries, walletID, accountID int64, amount int64, in Input) (db.Transaction, error) {
	return qtx.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: walletID, AccountID: accountID, Date: in.Date, Amount: amount,
		PaymentMode: paymodeInternalTransfer, Status: int64(in.Status), Memo: in.Memo,
	})
}

// Create makes a transfer: a negative leg in the source account and a positive
// leg in the destination, linked, in one DB transaction.
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Transfer, error) {
	if err := s.validate(ctx, walletID, &in); err != nil {
		return Transfer{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transfer{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	fromID, toID, err := s.CreateInTx(ctx, qtx, walletID, in)
	if err != nil {
		return Transfer{}, err
	}
	tr, err := qtx.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: fromID, TxnToID: fromID})
	if err != nil {
		return Transfer{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transfer{}, err
	}
	return Transfer{
		ID: tr.ID, FromAccountID: in.FromAccountID, ToAccountID: in.ToAccountID, Date: in.Date,
		FromAmount: in.FromAmount, ToAmount: in.ToAmount, Memo: in.Memo, Status: in.Status,
		TxnFromID: fromID, TxnToID: toID,
	}, nil
}

// CreateInTx inserts both transfer legs and the pairing row using the supplied
// querier, without committing — so callers (e.g. the scheduler) can post and
// advance their own state atomically. Returns the two leg ids. It defaults
// ToAmount to FromAmount but does not otherwise validate.
func (s *Service) CreateInTx(ctx context.Context, qtx *db.Queries, walletID int64, in Input) (fromID, toID int64, err error) {
	if in.ToAmount == 0 {
		in.ToAmount = in.FromAmount
	}
	from, err := s.insertLeg(ctx, qtx, walletID, in.FromAccountID, -in.FromAmount, in)
	if err != nil {
		return 0, 0, err
	}
	to, err := s.insertLeg(ctx, qtx, walletID, in.ToAccountID, in.ToAmount, in)
	if err != nil {
		return 0, 0, err
	}
	if _, err := qtx.InsertTransfer(ctx, db.InsertTransferParams{TxnFromID: from.ID, TxnToID: to.ID}); err != nil {
		return 0, 0, err
	}
	return from.ID, to.ID, nil
}

// Get returns a transfer by id (composed from its two legs).
func (s *Service) Get(ctx context.Context, walletID, transferID int64) (Transfer, error) {
	tr, err := s.q.GetTransfer(ctx, transferID)
	if errors.Is(err, sql.ErrNoRows) {
		return Transfer{}, ErrNotFound
	}
	if err != nil {
		return Transfer{}, err
	}
	from, err := s.q.GetTransaction(ctx, tr.TxnFromID)
	if err != nil {
		return Transfer{}, err
	}
	if from.WalletID != walletID {
		return Transfer{}, ErrNotFound
	}
	to, err := s.q.GetTransaction(ctx, tr.TxnToID)
	if err != nil {
		return Transfer{}, err
	}
	return Transfer{
		ID: tr.ID, FromAccountID: from.AccountID, ToAccountID: to.AccountID, Date: from.Date,
		FromAmount: -from.Amount, ToAmount: to.Amount, Memo: from.Memo, Status: int(from.Status),
		TxnFromID: from.ID, TxnToID: to.ID,
	}, nil
}

// Update changes a transfer's date, amounts and memo on both legs. Per-account
// status is left untouched (reconciled state is independent per account).
func (s *Service) Update(ctx context.Context, walletID, transferID int64, in Input) (Transfer, error) {
	existing, err := s.Get(ctx, walletID, transferID)
	if err != nil {
		return Transfer{}, err
	}
	// Accounts are fixed; amounts default and validate against the legs.
	in.FromAccountID, in.ToAccountID = existing.FromAccountID, existing.ToAccountID
	if in.ToAmount == 0 {
		in.ToAmount = in.FromAmount
	}
	if in.FromAmount <= 0 || in.ToAmount <= 0 {
		return Transfer{}, ErrInvalidAmount
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transfer{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if err := s.updateLeg(ctx, qtx, existing.TxnFromID, -in.FromAmount, in); err != nil {
		return Transfer{}, err
	}
	if err := s.updateLeg(ctx, qtx, existing.TxnToID, in.ToAmount, in); err != nil {
		return Transfer{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transfer{}, err
	}
	return s.Get(ctx, walletID, transferID)
}

func (s *Service) updateLeg(ctx context.Context, qtx *db.Queries, txnID, amount int64, in Input) error {
	cur, err := qtx.GetTransaction(ctx, txnID)
	if err != nil {
		return err
	}
	return qtx.UpdateTransaction(ctx, db.UpdateTransactionParams{
		Date: in.Date, Amount: amount, PaymentMode: paymodeInternalTransfer,
		Status:  cur.Status, // keep the leg's own status
		Info:    cur.Info,
		PayeeID: cur.PayeeID, CategoryID: cur.CategoryID, Memo: in.Memo, IsSplit: 0, ID: txnID,
	})
}

// Delete removes a transfer and both of its legs.
func (s *Service) Delete(ctx context.Context, walletID, transferID int64) error {
	tr, err := s.Get(ctx, walletID, transferID)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	if err := qtx.DeleteTransaction(ctx, tr.TxnFromID); err != nil {
		return err
	}
	if err := qtx.DeleteTransaction(ctx, tr.TxnToID); err != nil {
		return err
	}
	return tx.Commit()
}
