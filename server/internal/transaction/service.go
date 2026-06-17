// Package transaction manages transactions, their split lines and tags.
package transaction

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Payment modes (numerically HomeBank PAYMODE-compatible).
const minPaymentMode, maxPaymentMode = 0, 11

// Status values.
const (
	StatusNone = iota
	StatusCleared
	StatusReconciled
	StatusRemind
	StatusVoid
	statusCount
)

const dateLayout = "2006-01-02"

// Sentinel errors.
var (
	ErrNotFound           = errors.New("transaction: not found")
	ErrInvalidAccount     = errors.New("transaction: account does not belong to the wallet")
	ErrInvalidPaymentMode = errors.New("transaction: invalid payment mode")
	ErrInvalidStatus      = errors.New("transaction: invalid status")
	ErrInvalidDate        = errors.New("transaction: invalid date (want YYYY-MM-DD)")
	ErrSplitMismatch      = errors.New("transaction: split amounts must sum to the transaction amount")
	ErrEmptySplit         = errors.New("transaction: a split transaction needs at least one line")
)

// Split is one line of a split transaction.
type Split struct {
	CategoryID *int64 `json:"categoryId"`
	Amount     int64  `json:"amount"`
	Memo       string `json:"memo"`
}

// Transaction is the public representation of a transaction.
type Transaction struct {
	ID           int64    `json:"id"`
	AccountID    int64    `json:"accountId"`
	Date         string   `json:"date"`
	Amount       int64    `json:"amount"`
	PaymentMode  int      `json:"paymentMode"`
	Status       int      `json:"status"`
	Info         string   `json:"info"`
	PayeeID      *int64   `json:"payeeId,omitempty"`
	CategoryID   *int64   `json:"categoryId,omitempty"`
	Memo         string   `json:"memo"`
	IsSplit      bool     `json:"isSplit"`
	Tags         []string `json:"tags"`
	Splits       []Split  `json:"splits,omitempty"`
	PayeeName    string   `json:"payeeName,omitempty"`
	CategoryName string   `json:"categoryName,omitempty"`
	// TransferID and TransferAccountID are set when the transaction is one leg of
	// an internal transfer; the UI uses them to open the transfer editor and to
	// warn that deleting the row also removes the paired leg.
	TransferID        *int64 `json:"transferId,omitempty"`
	TransferAccountID *int64 `json:"transferAccountId,omitempty"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

// Input carries the editable fields of a transaction. When Splits is non-empty
// the transaction is a split (and CategoryID is ignored).
type Input struct {
	AccountID   int64
	Date        string
	Amount      int64
	PaymentMode int
	Status      int
	Info        string
	PayeeID     *int64
	CategoryID  *int64
	Memo        string
	Tags        []string
	Splits      []Split
}

// Service implements transaction management.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

func nullID(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func idPtr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// AccountInWallet reports whether accountID exists and belongs to walletID.
func (s *Service) AccountInWallet(ctx context.Context, walletID, accountID int64) (bool, error) {
	acc, err := s.q.GetAccount(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return acc.WalletID == walletID, nil
}

func (s *Service) validate(ctx context.Context, walletID int64, in *Input) error {
	ok, err := s.AccountInWallet(ctx, walletID, in.AccountID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidAccount
	}
	if in.PaymentMode < minPaymentMode || in.PaymentMode > maxPaymentMode {
		return ErrInvalidPaymentMode
	}
	if in.Status < 0 || in.Status >= statusCount {
		return ErrInvalidStatus
	}
	if _, err := time.Parse(dateLayout, in.Date); err != nil {
		return ErrInvalidDate
	}
	if len(in.Splits) > 0 {
		var sum int64
		for _, sp := range in.Splits {
			sum += sp.Amount
		}
		if sum != in.Amount {
			return ErrSplitMismatch
		}
	}
	return nil
}

// Create inserts a transaction with its splits and tags, atomically.
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Transaction, error) {
	if err := s.validate(ctx, walletID, &in); err != nil {
		return Transaction{}, err
	}
	isSplit := len(in.Splits) > 0
	categoryID := in.CategoryID
	if isSplit {
		categoryID = nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	row, err := qtx.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: walletID, AccountID: in.AccountID, Date: in.Date, Amount: in.Amount,
		PaymentMode: int64(in.PaymentMode), Status: int64(in.Status), Info: in.Info,
		PayeeID: nullID(in.PayeeID), CategoryID: nullID(categoryID), Memo: in.Memo, IsSplit: b2i(isSplit),
	})
	if err != nil {
		return Transaction{}, err
	}
	if err := s.writeSplitsAndTags(ctx, qtx, walletID, row.ID, in); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.Get(ctx, row.ID)
}

// Update replaces a transaction's fields, splits and tags.
func (s *Service) Update(ctx context.Context, walletID, id int64, in Input) (Transaction, error) {
	if err := s.validate(ctx, walletID, &in); err != nil {
		return Transaction{}, err
	}
	isSplit := len(in.Splits) > 0
	categoryID := in.CategoryID
	if isSplit {
		categoryID = nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if err := qtx.UpdateTransaction(ctx, db.UpdateTransactionParams{
		Date: in.Date, Amount: in.Amount, PaymentMode: int64(in.PaymentMode), Status: int64(in.Status),
		Info: in.Info, PayeeID: nullID(in.PayeeID), CategoryID: nullID(categoryID), Memo: in.Memo,
		IsSplit: b2i(isSplit), ID: id,
	}); err != nil {
		return Transaction{}, err
	}
	if err := qtx.DeleteSplits(ctx, id); err != nil {
		return Transaction{}, err
	}
	if err := qtx.DeleteTransactionTags(ctx, id); err != nil {
		return Transaction{}, err
	}
	if err := s.writeSplitsAndTags(ctx, qtx, walletID, id, in); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) writeSplitsAndTags(ctx context.Context, qtx *db.Queries, walletID, txID int64, in Input) error {
	for i, sp := range in.Splits {
		if err := qtx.InsertSplit(ctx, db.InsertSplitParams{
			TransactionID: txID, CategoryID: nullID(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo, Position: int64(i),
		}); err != nil {
			return err
		}
	}
	seen := map[string]bool{}
	for _, name := range in.Tags {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		tag, err := s.getOrCreateTag(ctx, qtx, walletID, name)
		if err != nil {
			return err
		}
		if err := qtx.AddTransactionTag(ctx, db.AddTransactionTagParams{TransactionID: txID, TagID: tag.ID}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) getOrCreateTag(ctx context.Context, qtx *db.Queries, walletID int64, name string) (db.Tag, error) {
	tag, err := qtx.GetTagByName(ctx, db.GetTagByNameParams{WalletID: walletID, Name: name})
	if err == nil {
		return tag, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return db.Tag{}, err
	}
	return qtx.InsertTag(ctx, db.InsertTagParams{WalletID: walletID, Name: name})
}

// Get returns a transaction with its splits and tags.
func (s *Service) Get(ctx context.Context, id int64) (Transaction, error) {
	row, err := s.q.GetTransaction(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Transaction{}, ErrNotFound
	}
	if err != nil {
		return Transaction{}, err
	}
	out := Transaction{
		ID: row.ID, AccountID: row.AccountID, Date: row.Date, Amount: row.Amount,
		PaymentMode: int(row.PaymentMode), Status: int(row.Status), Info: row.Info,
		PayeeID: idPtr(row.PayeeID), CategoryID: idPtr(row.CategoryID), Memo: row.Memo,
		IsSplit: row.IsSplit != 0, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		Tags: []string{},
	}
	tags, err := s.q.ListTransactionTags(ctx, id)
	if err != nil {
		return Transaction{}, err
	}
	out.Tags = append(out.Tags, tags...)
	if out.IsSplit {
		splits, err := s.q.ListSplits(ctx, id)
		if err != nil {
			return Transaction{}, err
		}
		for _, sp := range splits {
			out.Splits = append(out.Splits, Split{CategoryID: idPtr(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo})
		}
	}
	if out.TransferID, out.TransferAccountID, err = s.transferInfo(ctx, id); err != nil {
		return Transaction{}, err
	}
	return out, nil
}

// transferInfo returns the transfer id and the counterpart leg's account id when
// txnID is one leg of an internal transfer; (nil, nil) otherwise.
func (s *Service) transferInfo(ctx context.Context, txnID int64) (*int64, *int64, error) {
	tr, err := s.q.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: txnID, TxnToID: txnID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	otherTxn := tr.TxnToID
	if otherTxn == txnID {
		otherTxn = tr.TxnFromID
	}
	other, err := s.q.GetTransaction(ctx, otherTxn)
	if err != nil {
		return nil, nil, err
	}
	id, acc := tr.ID, other.AccountID
	return &id, &acc, nil
}

// WalletOf returns the wallet id a transaction belongs to (for ownership
// checks), or ErrNotFound.
func (s *Service) WalletOf(ctx context.Context, id int64) (int64, error) {
	row, err := s.q.GetTransaction(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return row.WalletID, nil
}

// List returns a page of an account's transactions (newest first) and the total
// count. Tags and splits are omitted here; fetch a single transaction for those.
func (s *Service) List(ctx context.Context, accountID int64, limit, offset int64) ([]Transaction, int64, error) {
	rows, err := s.q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{
		AccountID: accountID, Limit: limit, Offset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountTransactionsForAccount(ctx, accountID)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Transaction, 0, len(rows))
	for _, r := range rows {
		t := Transaction{
			ID: r.ID, AccountID: r.AccountID, Date: r.Date, Amount: r.Amount,
			PaymentMode: int(r.PaymentMode), Status: int(r.Status), Info: r.Info,
			PayeeID: idPtr(r.PayeeID), CategoryID: idPtr(r.CategoryID), Memo: r.Memo,
			IsSplit: r.IsSplit != 0, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, Tags: []string{},
		}
		if r.PayeeName.Valid {
			t.PayeeName = r.PayeeName.String
		}
		if r.CategoryName.Valid {
			t.CategoryName = r.CategoryName.String
		}
		if t.TransferID, t.TransferAccountID, err = s.transferInfo(ctx, r.ID); err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, nil
}

// Delete removes a transaction (its splits and tag links cascade). When the
// transaction is one leg of an internal transfer, the paired leg is removed too
// (and the transfers row cascades) so no orphan legs are ever left behind.
func (s *Service) Delete(ctx context.Context, id int64) error {
	tr, err := s.q.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: id, TxnToID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return s.q.DeleteTransaction(ctx, id)
	}
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

// FindDuplicates returns transactions in the same account with the same amount
// within windowDays of date (a non-blocking warning for the UI).
func (s *Service) FindDuplicates(ctx context.Context, accountID int64, date string, amount int64, windowDays int) ([]Transaction, error) {
	d, err := time.Parse(dateLayout, date)
	if err != nil {
		return nil, ErrInvalidDate
	}
	from := d.AddDate(0, 0, -windowDays).Format(dateLayout)
	to := d.AddDate(0, 0, windowDays).Format(dateLayout)
	rows, err := s.q.FindDuplicateTransactions(ctx, db.FindDuplicateTransactionsParams{
		AccountID: accountID, Amount: amount, Date: from, Date_2: to,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Transaction, 0, len(rows))
	for _, r := range rows {
		out = append(out, Transaction{ID: r.ID, AccountID: r.AccountID, Date: r.Date, Amount: r.Amount, Memo: r.Memo})
	}
	return out, nil
}

// ListTags returns a wallet's tag names.
func (s *Service) ListTags(ctx context.Context, walletID int64) ([]string, error) {
	rows, err := s.q.ListTagsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, t := range rows {
		out = append(out, t.Name)
	}
	return out, nil
}
