// Package template manages reusable transaction templates: a saved scaffold
// (every transaction field, optional split lines, and an optional transfer
// target) that pre-fills the entry form.
package template

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/dbconv"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound       = errors.New("template: not found")
	ErrNameRequired   = errors.New("template: name is required")
	ErrInvalidAccount = errors.New("template: account does not belong to the wallet")
)

// Split is one line of a split template.
type Split struct {
	CategoryID *int64 `json:"categoryId"`
	Amount     int64  `json:"amount"`
	Memo       string `json:"memo"`
}

// Template is the public representation of a template.
type Template struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	AccountID   *int64   `json:"accountId,omitempty"`
	Amount      int64    `json:"amount"`
	PaymentMode int      `json:"paymentMode"`
	Status      int      `json:"status"`
	Info        string   `json:"info"`
	PayeeID     *int64   `json:"payeeId,omitempty"`
	CategoryID  *int64   `json:"categoryId,omitempty"`
	Memo        string   `json:"memo"`
	Tags        []string `json:"tags"`
	IsSplit     bool     `json:"isSplit"`
	IsTransfer  bool     `json:"isTransfer"`
	ToAccountID *int64   `json:"toAccountId,omitempty"`
	Splits      []Split  `json:"splits,omitempty"`
	CreatedAt   string   `json:"createdAt"`
}

// Input carries the editable fields of a template.
type Input struct {
	Name        string
	AccountID   *int64
	Amount      int64
	PaymentMode int
	Status      int
	Info        string
	PayeeID     *int64
	CategoryID  *int64
	Memo        string
	Tags        []string
	IsTransfer  bool
	ToAccountID *int64
	Splits      []Split
}

// Service implements template management.
type Service struct {
	db *sql.DB
	q  *db.Queries // write pool (mutations)
	rq *db.Queries // read pool (read-only methods)
}

// NewService builds a Service backed by the write connection pool for both
// reads and writes.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(write)}
}

// NewServiceWithRead builds a Service whose read-only methods run on the read
// pool while mutations use the single write connection.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(read)}
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

func joinTags(tags []string) string { return strings.Join(dedupe(tags), ",") }

func splitTags(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}

func dedupe(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func (s *Service) accountInWallet(ctx context.Context, walletID, accountID int64) error {
	acc, err := s.q.GetAccount(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && acc.WalletID != walletID) {
		return ErrInvalidAccount
	}
	return err
}

func (s *Service) validate(ctx context.Context, walletID int64, in *Input) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return ErrNameRequired
	}
	for _, id := range []*int64{in.AccountID, in.ToAccountID} {
		if id != nil {
			if err := s.accountInWallet(ctx, walletID, *id); err != nil {
				return err
			}
		}
	}
	return nil
}

// Create stores a new template (with its split lines) in one transaction.
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Template, error) {
	if err := s.validate(ctx, walletID, &in); err != nil {
		return Template{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Template{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	row, err := qtx.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: walletID, Name: in.Name, AccountID: nullID(in.AccountID), Amount: in.Amount,
		PaymentMode: int64(in.PaymentMode), Status: int64(in.Status), Info: in.Info,
		PayeeID: nullID(in.PayeeID), CategoryID: nullID(in.CategoryID), Memo: in.Memo,
		Tags: joinTags(in.Tags), IsSplit: dbconv.B2i(len(in.Splits) > 0), IsTransfer: dbconv.B2i(in.IsTransfer),
		ToAccountID: nullID(in.ToAccountID),
	})
	if err != nil {
		return Template{}, err
	}
	if err := s.writeSplits(ctx, qtx, row.ID, in.Splits); err != nil {
		return Template{}, err
	}
	if err := tx.Commit(); err != nil {
		return Template{}, err
	}
	return s.Get(ctx, row.ID)
}

func (s *Service) writeSplits(ctx context.Context, qtx *db.Queries, templateID int64, splits []Split) error {
	for i, sp := range splits {
		if err := qtx.InsertTemplateSplit(ctx, db.InsertTemplateSplitParams{
			TemplateID: templateID, CategoryID: nullID(sp.CategoryID), Amount: sp.Amount,
			Memo: sp.Memo, Position: int64(i),
		}); err != nil {
			return err
		}
	}
	return nil
}

func toTemplate(row db.Template) Template {
	return Template{
		ID: row.ID, Name: row.Name, AccountID: idPtr(row.AccountID), Amount: row.Amount,
		PaymentMode: int(row.PaymentMode), Status: int(row.Status), Info: row.Info,
		PayeeID: idPtr(row.PayeeID), CategoryID: idPtr(row.CategoryID), Memo: row.Memo,
		Tags: splitTags(row.Tags), IsSplit: row.IsSplit != 0, IsTransfer: row.IsTransfer != 0,
		ToAccountID: idPtr(row.ToAccountID), CreatedAt: row.CreatedAt,
	}
}

// Get returns a template with its split lines.
func (s *Service) Get(ctx context.Context, id int64) (Template, error) {
	row, err := s.rq.GetTemplate(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Template{}, ErrNotFound
	}
	if err != nil {
		return Template{}, err
	}
	out := toTemplate(row)
	if out.IsSplit {
		splits, err := s.rq.ListTemplateSplits(ctx, id)
		if err != nil {
			return Template{}, err
		}
		for _, sp := range splits {
			out.Splits = append(out.Splits, Split{CategoryID: idPtr(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo})
		}
	}
	return out, nil
}

// WalletOf returns the wallet a template belongs to (for ownership checks).
func (s *Service) WalletOf(ctx context.Context, id int64) (int64, error) {
	row, err := s.rq.GetTemplate(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return row.WalletID, nil
}

// List returns a wallet's templates (with split lines), name-sorted.
func (s *Service) List(ctx context.Context, walletID int64) ([]Template, error) {
	rows, err := s.rq.ListTemplatesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Template, 0, len(rows))
	for _, row := range rows {
		t := toTemplate(row)
		if t.IsSplit {
			splits, err := s.rq.ListTemplateSplits(ctx, row.ID)
			if err != nil {
				return nil, err
			}
			for _, sp := range splits {
				t.Splits = append(t.Splits, Split{CategoryID: idPtr(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo})
			}
		}
		out = append(out, t)
	}
	return out, nil
}

// Update replaces a template's fields and split lines.
func (s *Service) Update(ctx context.Context, walletID, id int64, in Input) (Template, error) {
	if err := s.validate(ctx, walletID, &in); err != nil {
		return Template{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Template{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if err := qtx.UpdateTemplate(ctx, db.UpdateTemplateParams{
		Name: in.Name, AccountID: nullID(in.AccountID), Amount: in.Amount,
		PaymentMode: int64(in.PaymentMode), Status: int64(in.Status), Info: in.Info,
		PayeeID: nullID(in.PayeeID), CategoryID: nullID(in.CategoryID), Memo: in.Memo,
		Tags: joinTags(in.Tags), IsSplit: dbconv.B2i(len(in.Splits) > 0), IsTransfer: dbconv.B2i(in.IsTransfer),
		ToAccountID: nullID(in.ToAccountID), ID: id,
	}); err != nil {
		return Template{}, err
	}
	if err := qtx.DeleteTemplateSplits(ctx, id); err != nil {
		return Template{}, err
	}
	if err := s.writeSplits(ctx, qtx, id, in.Splits); err != nil {
		return Template{}, err
	}
	if err := tx.Commit(); err != nil {
		return Template{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes a template (its split lines cascade).
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.q.DeleteTemplate(ctx, id)
}

// CreateFromTransaction builds a template capturing every field of an existing
// transaction, including its splits, tags and — if it is a transfer leg — the
// transfer target account.
func (s *Service) CreateFromTransaction(ctx context.Context, walletID, txnID int64, name string) (Template, error) {
	txn, err := s.q.GetTransaction(ctx, txnID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && txn.WalletID != walletID) {
		return Template{}, ErrNotFound
	}
	if err != nil {
		return Template{}, err
	}

	in := Input{
		Name: name, AccountID: &txn.AccountID, Amount: txn.Amount,
		PaymentMode: int(txn.PaymentMode), Status: int(txn.Status), Info: txn.Info,
		PayeeID: idPtr(txn.PayeeID), CategoryID: idPtr(txn.CategoryID), Memo: txn.Memo,
	}
	tags, err := s.q.ListTransactionTags(ctx, txnID)
	if err != nil {
		return Template{}, err
	}
	in.Tags = tags
	if txn.IsSplit != 0 {
		splits, err := s.q.ListSplits(ctx, txnID)
		if err != nil {
			return Template{}, err
		}
		for _, sp := range splits {
			in.Splits = append(in.Splits, Split{CategoryID: idPtr(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo})
		}
	}

	// If the transaction is one leg of a transfer, capture it as a transfer
	// template from the source account to the destination account.
	tr, err := s.q.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: txnID, TxnToID: txnID})
	if err == nil {
		from, err := s.q.GetTransaction(ctx, tr.TxnFromID)
		if err != nil {
			return Template{}, err
		}
		to, err := s.q.GetTransaction(ctx, tr.TxnToID)
		if err != nil {
			return Template{}, err
		}
		in.IsTransfer = true
		in.AccountID = &from.AccountID
		in.ToAccountID = &to.AccountID
		in.Amount = from.Amount
		in.Splits = nil
		in.PayeeID, in.CategoryID = nil, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Template{}, err
	}

	return s.Create(ctx, walletID, in)
}
