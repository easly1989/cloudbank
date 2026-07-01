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
	ErrTagNotFound        = errors.New("tag: not found")
	ErrTagDuplicate       = errors.New("tag: a tag with that name already exists")
	ErrTagInvalid         = errors.New("tag: invalid name or target")
	ErrVehicleNotFound    = errors.New("vehicle: not found")
	ErrVehicleDuplicate   = errors.New("vehicle: a vehicle with that name already exists")
	ErrVehicleInvalid     = errors.New("vehicle: name is required")
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
	VehicleID    *int64   `json:"vehicleId,omitempty"`
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
	// AttachmentCount is the number of files attached to the transaction. It is
	// populated for register rows so the ledger can show a paperclip glyph.
	AttachmentCount int    `json:"attachmentCount"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
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
	VehicleID   *int64
	Memo        string
	Tags        []string
	Splits      []Split
	// ImportRef is an optional external reference (e.g. an OFX FITID) recorded so
	// re-importing the same file can detect already-imported rows. Empty for
	// manual entry.
	ImportRef string
}

// Service implements transaction management.
type Service struct {
	db *sql.DB
	q  *db.Queries
	// purgeAttachments, when set, removes the backing files of the given
	// transactions' attachments. The DB rows cascade on transaction delete; this
	// hook cleans the on-disk files. It is injected to avoid a hard dependency on
	// the attachment service (which owns the filesystem).
	purgeAttachments func(ctx context.Context, txnIDs []int64) error
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// SetAttachmentPurger wires the attachment file cleanup invoked when a
// transaction is deleted. Optional; when unset, deletion skips file cleanup.
func (s *Service) SetAttachmentPurger(fn func(ctx context.Context, txnIDs []int64) error) {
	s.purgeAttachments = fn
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

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	id, err := s.CreateInTx(ctx, qtx, walletID, in)
	if err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.Get(ctx, id)
}

// CreateInTx inserts a transaction (with splits and tags) using the supplied
// querier, without committing — so callers (e.g. the scheduler) can post and
// advance their own state atomically in one transaction. It does not validate;
// callers that accept untrusted input should validate first.
func (s *Service) CreateInTx(ctx context.Context, qtx *db.Queries, walletID int64, in Input) (int64, error) {
	isSplit := len(in.Splits) > 0
	categoryID := in.CategoryID
	if isSplit {
		categoryID = nil
	}
	row, err := qtx.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: walletID, AccountID: in.AccountID, Date: in.Date, Amount: in.Amount,
		PaymentMode: int64(in.PaymentMode), Status: int64(in.Status), Info: in.Info,
		PayeeID: nullID(in.PayeeID), CategoryID: nullID(categoryID), Memo: in.Memo, IsSplit: b2i(isSplit),
		ImportRef: in.ImportRef, VehicleID: nullID(in.VehicleID),
	})
	if err != nil {
		return 0, err
	}
	if err := s.writeSplitsAndTags(ctx, qtx, walletID, row.ID, in); err != nil {
		return 0, err
	}
	return row.ID, nil
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
		IsSplit: b2i(isSplit), VehicleID: nullID(in.VehicleID), ID: id,
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
		PayeeID: idPtr(row.PayeeID), CategoryID: idPtr(row.CategoryID), VehicleID: idPtr(row.VehicleID),
		Memo:    row.Memo,
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

// RegisterRow is a register ledger row: a transaction plus its chronological
// running balance (initial balance + cumulative amount up to and including it).
type RegisterRow struct {
	Transaction
	RunningBalance int64 `json:"runningBalance"`
}

// RegisterSummary holds an account's headline balances (HomeBank semantics).
type RegisterSummary struct {
	Bank   int64 `json:"bank"`   // initial + cleared/reconciled amounts
	Today  int64 `json:"today"`  // initial + amounts dated on or before today
	Future int64 `json:"future"` // initial + all amounts
}

// Register returns the full account ledger in chronological order (date, then
// id) with a server-computed running balance per row, plus the account's
// bank/today/future headline balances. Transfer legs carry transferId so the
// register can flag them. Splits/tags are omitted (fetch a single transaction).
func (s *Service) Register(ctx context.Context, accountID int64) ([]RegisterRow, RegisterSummary, error) {
	acc, err := s.q.GetAccount(ctx, accountID)
	if err != nil {
		return nil, RegisterSummary{}, err
	}
	rows, err := s.q.ListAccountRegister(ctx, accountID)
	if err != nil {
		return nil, RegisterSummary{}, err
	}
	today := time.Now().UTC().Format(dateLayout)
	out := make([]RegisterRow, 0, len(rows))
	sum := RegisterSummary{Bank: acc.InitialBalance, Today: acc.InitialBalance, Future: acc.InitialBalance}
	for _, r := range rows {
		row := RegisterRow{
			Transaction: Transaction{
				ID: r.ID, AccountID: r.AccountID, Date: r.Date, Amount: r.Amount,
				PaymentMode: int(r.PaymentMode), Status: int(r.Status), Info: r.Info,
				PayeeID: idPtr(r.PayeeID), CategoryID: idPtr(r.CategoryID), Memo: r.Memo,
				IsSplit: r.IsSplit != 0, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
				Tags:       splitTags(r.Tags),
				TransferID: idPtr(r.TransferID), TransferAccountID: idPtr(r.TransferAccountID),
				AttachmentCount: int(r.AttachmentCount),
			},
			RunningBalance: acc.InitialBalance + r.RunningDelta,
		}
		if r.PayeeName.Valid {
			row.PayeeName = r.PayeeName.String
		}
		if r.CategoryName.Valid {
			row.CategoryName = r.CategoryName.String
		}
		sum.Future += r.Amount
		if r.Date <= today {
			sum.Today += r.Amount
		}
		if r.Status == StatusCleared || r.Status == StatusReconciled {
			sum.Bank += r.Amount
		}
		out = append(out, row)
	}
	return out, sum, nil
}

// splitTags turns a group_concat list ("a,b,c") into a slice (empty when none).
// The column is an untyped expression, so the driver hands back string/[]byte.
func splitTags(v any) []string {
	var s string
	switch t := v.(type) {
	case string:
		s = t
	case []byte:
		s = string(t)
	}
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}

// Bulk-edit fields (each request sets exactly one of these across the selection).
const (
	BulkFieldStatus      = "status"
	BulkFieldCategory    = "category"
	BulkFieldPayee       = "payee"
	BulkFieldPaymentMode = "paymentMode"
)

// ErrInvalidBulkField is returned for an unknown bulk-edit field.
var ErrInvalidBulkField = errors.New("transaction: invalid bulk field")

// BulkUpdate atomically sets one field across the given transactions (all must
// belong to walletID). It is all-or-nothing: any failure rolls the whole batch
// back. value is nil to clear category/payee; it is required for status and
// payment mode. Returns the number of transactions updated.
func (s *Service) BulkUpdate(ctx context.Context, walletID int64, ids []int64, field string, value *int64) (int, error) {
	switch field {
	case BulkFieldStatus:
		if value == nil || *value < 0 || *value >= statusCount {
			return 0, ErrInvalidStatus
		}
	case BulkFieldPaymentMode:
		if value == nil || *value < minPaymentMode || *value > maxPaymentMode {
			return 0, ErrInvalidPaymentMode
		}
	case BulkFieldCategory, BulkFieldPayee:
		// value may be nil (clear) or an id; ownership of a non-nil target is
		// validated below against the wallet.
	default:
		return 0, ErrInvalidBulkField
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if value != nil && (field == BulkFieldCategory || field == BulkFieldPayee) {
		if err := s.validateTarget(ctx, qtx, walletID, field, *value); err != nil {
			return 0, err
		}
	}

	for _, id := range ids {
		row, err := qtx.GetTransaction(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
			return 0, ErrNotFound
		}
		if err != nil {
			return 0, err
		}
		if err := applyBulkField(ctx, qtx, id, field, value); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(ids), nil
}

func (s *Service) validateTarget(ctx context.Context, qtx *db.Queries, walletID int64, field string, id int64) error {
	if field == BulkFieldCategory {
		cat, err := qtx.GetCategory(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && cat.WalletID != walletID) {
			return ErrNotFound
		}
		return err
	}
	pe, err := qtx.GetPayee(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && pe.WalletID != walletID) {
		return ErrNotFound
	}
	return err
}

func applyBulkField(ctx context.Context, qtx *db.Queries, id int64, field string, value *int64) error {
	switch field {
	case BulkFieldStatus:
		return qtx.UpdateTransactionStatus(ctx, db.UpdateTransactionStatusParams{Status: *value, ID: id})
	case BulkFieldPaymentMode:
		return qtx.SetTransactionPaymentMode(ctx, db.SetTransactionPaymentModeParams{PaymentMode: *value, ID: id})
	case BulkFieldCategory:
		return qtx.SetTransactionCategory(ctx, db.SetTransactionCategoryParams{CategoryID: nullID(value), ID: id})
	case BulkFieldPayee:
		return qtx.SetTransactionPayee(ctx, db.SetTransactionPayeeParams{PayeeID: nullID(value), ID: id})
	}
	return ErrInvalidBulkField
}

// Delete removes a transaction (its splits and tag links cascade). When the
// transaction is one leg of an internal transfer, the paired leg is removed too
// (and the transfers row cascades) so no orphan legs are ever left behind.
func (s *Service) Delete(ctx context.Context, id int64) error {
	tr, err := s.q.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: id, TxnToID: id})
	if errors.Is(err, sql.ErrNoRows) {
		// Remove attachment files before the delete cascades away their rows.
		s.purgeFiles(ctx, id)
		return s.q.DeleteTransaction(ctx, id)
	}
	if err != nil {
		return err
	}
	// Remove attachment files of both legs before the delete cascades their rows.
	s.purgeFiles(ctx, tr.TxnFromID, tr.TxnToID)
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

// purgeFiles best-effort removes the on-disk files of the given transactions'
// attachments. Call it before the DB rows cascade away (the purger reads them
// to find the files). Failures are ignored so a filesystem hiccup never fails
// the delete — an orphaned file is harmless.
func (s *Service) purgeFiles(ctx context.Context, txnIDs ...int64) {
	if s.purgeAttachments == nil {
		return
	}
	_ = s.purgeAttachments(ctx, txnIDs)
}

// SetStatus updates only a transaction's reconciliation status (used by the
// register's inline status toggle); tags and splits are left untouched. Status
// is per-transaction, so a transfer leg's status is independent of its pair.
func (s *Service) SetStatus(ctx context.Context, id int64, status int) error {
	if status < 0 || status >= statusCount {
		return ErrInvalidStatus
	}
	return s.q.UpdateTransactionStatus(ctx, db.UpdateTransactionStatusParams{
		Status: int64(status), ID: id,
	})
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

// TagInfo is a tag with how many transactions use it.
type TagInfo struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// ListTagsWithCounts returns the wallet's tags with their usage counts.
func (s *Service) ListTagsWithCounts(ctx context.Context, walletID int64) ([]TagInfo, error) {
	rows, err := s.q.ListTagsWithCounts(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]TagInfo, 0, len(rows))
	for _, r := range rows {
		out = append(out, TagInfo{ID: r.ID, Name: r.Name, Count: r.Count})
	}
	return out, nil
}

// tagInWallet loads a tag and verifies it belongs to the wallet.
func (s *Service) tagInWallet(ctx context.Context, walletID, tagID int64) (db.Tag, error) {
	tag, err := s.q.GetTag(ctx, tagID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && tag.WalletID != walletID) {
		return db.Tag{}, ErrTagNotFound
	}
	return tag, err
}

// RenameTag renames a tag. Renaming onto an existing name is rejected (use
// MergeTags to combine them).
func (s *Service) RenameTag(ctx context.Context, walletID, tagID int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrTagInvalid
	}
	if _, err := s.tagInWallet(ctx, walletID, tagID); err != nil {
		return err
	}
	if existing, err := s.q.GetTagByName(ctx, db.GetTagByNameParams{WalletID: walletID, Name: name}); err == nil && existing.ID != tagID {
		return ErrTagDuplicate
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return s.q.RenameTag(ctx, db.RenameTagParams{Name: name, ID: tagID})
}

// MergeTags moves every transaction tagged with sourceID onto targetID and
// deletes the source tag.
func (s *Service) MergeTags(ctx context.Context, walletID, sourceID, targetID int64) error {
	if sourceID == targetID {
		return ErrTagInvalid
	}
	if _, err := s.tagInWallet(ctx, walletID, sourceID); err != nil {
		return err
	}
	if _, err := s.tagInWallet(ctx, walletID, targetID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	if err := qtx.ReassignTag(ctx, db.ReassignTagParams{TagID: targetID, TagID_2: sourceID}); err != nil {
		return err
	}
	if err := qtx.DeleteTag(ctx, sourceID); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteTag removes a tag and untags it from every transaction.
func (s *Service) DeleteTag(ctx context.Context, walletID, tagID int64) error {
	if _, err := s.tagInWallet(ctx, walletID, tagID); err != nil {
		return err
	}
	return s.q.DeleteTag(ctx, tagID)
}

// Vehicle is a managed vehicle for the car-cost report.
type Vehicle struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Plate string `json:"plate"`
	Notes string `json:"notes"`
}

func toVehicle(v db.Vehicle) Vehicle {
	return Vehicle{ID: v.ID, Name: v.Name, Plate: v.Plate, Notes: v.Notes}
}

// ListVehicles returns the wallet's vehicles by name.
func (s *Service) ListVehicles(ctx context.Context, walletID int64) ([]Vehicle, error) {
	rows, err := s.q.ListVehiclesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Vehicle, 0, len(rows))
	for _, v := range rows {
		out = append(out, toVehicle(v))
	}
	return out, nil
}

func (s *Service) vehicleInWallet(ctx context.Context, walletID, id int64) (db.Vehicle, error) {
	v, err := s.q.GetVehicle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && v.WalletID != walletID) {
		return db.Vehicle{}, ErrVehicleNotFound
	}
	return v, err
}

// CreateVehicle adds a vehicle.
func (s *Service) CreateVehicle(ctx context.Context, walletID int64, name, plate, notes string) (Vehicle, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Vehicle{}, ErrVehicleInvalid
	}
	v, err := s.q.InsertVehicle(ctx, db.InsertVehicleParams{WalletID: walletID, Name: name, Plate: plate, Notes: notes})
	if err != nil {
		if isUniqueViolation(err) {
			return Vehicle{}, ErrVehicleDuplicate
		}
		return Vehicle{}, err
	}
	return toVehicle(v), nil
}

// UpdateVehicle renames/edits a vehicle.
func (s *Service) UpdateVehicle(ctx context.Context, walletID, id int64, name, plate, notes string) (Vehicle, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Vehicle{}, ErrVehicleInvalid
	}
	if _, err := s.vehicleInWallet(ctx, walletID, id); err != nil {
		return Vehicle{}, err
	}
	if err := s.q.UpdateVehicle(ctx, db.UpdateVehicleParams{Name: name, Plate: plate, Notes: notes, ID: id}); err != nil {
		if isUniqueViolation(err) {
			return Vehicle{}, ErrVehicleDuplicate
		}
		return Vehicle{}, err
	}
	return s.vehicleGet(ctx, id)
}

func (s *Service) vehicleGet(ctx context.Context, id int64) (Vehicle, error) {
	v, err := s.q.GetVehicle(ctx, id)
	if err != nil {
		return Vehicle{}, err
	}
	return toVehicle(v), nil
}

// DeleteVehicle removes a vehicle; its transactions keep their data but are
// unlinked (vehicle_id → NULL via ON DELETE SET NULL).
func (s *Service) DeleteVehicle(ctx context.Context, walletID, id int64) error {
	if _, err := s.vehicleInWallet(ctx, walletID, id); err != nil {
		return err
	}
	return s.q.DeleteVehicle(ctx, id)
}
