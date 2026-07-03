// Package payee manages payees within a wallet, including merge and
// delete-with-reassignment.
package payee

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound      = errors.New("payee: not found")
	ErrDuplicate     = errors.New("payee: name already used")
	ErrSelfReference = errors.New("payee: cannot merge a payee into itself")
	ErrBadTarget     = errors.New("payee: invalid merge target")
)

// Payee is the public representation of a payee.
type Payee struct {
	ID                 int64
	WalletID           int64
	Name               string
	DefaultCategoryID  *int64
	DefaultPaymentMode *int64
}

func toPayee(p db.Payee) Payee {
	out := Payee{ID: p.ID, WalletID: p.WalletID, Name: p.Name}
	if p.DefaultCategoryID.Valid {
		v := p.DefaultCategoryID.Int64
		out.DefaultCategoryID = &v
	}
	if p.DefaultPaymentMode.Valid {
		v := p.DefaultPaymentMode.Int64
		out.DefaultPaymentMode = &v
	}
	return out
}

func nullID(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

// Service implements payee management.
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

// List returns a wallet's payees.
func (s *Service) List(ctx context.Context, walletID int64) ([]Payee, error) {
	rows, err := s.rq.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Payee, 0, len(rows))
	for _, p := range rows {
		out = append(out, toPayee(p))
	}
	return out, nil
}

// Get returns a payee by id.
func (s *Service) Get(ctx context.Context, id int64) (Payee, error) {
	p, err := s.rq.GetPayee(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Payee{}, ErrNotFound
	}
	if err != nil {
		return Payee{}, err
	}
	return toPayee(p), nil
}

// Create adds a payee.
func (s *Service) Create(ctx context.Context, walletID int64, name string, defaultCategoryID, defaultPaymentMode *int64) (Payee, error) {
	p, err := s.q.InsertPayee(ctx, db.InsertPayeeParams{
		WalletID: walletID, Name: name,
		DefaultCategoryID: nullID(defaultCategoryID), DefaultPaymentMode: nullID(defaultPaymentMode),
	})
	if err != nil {
		if isUnique(err) {
			return Payee{}, ErrDuplicate
		}
		return Payee{}, err
	}
	return toPayee(p), nil
}

// Update changes a payee's name and defaults.
func (s *Service) Update(ctx context.Context, id int64, name string, defaultCategoryID, defaultPaymentMode *int64) (Payee, error) {
	if err := s.q.UpdatePayee(ctx, db.UpdatePayeeParams{
		Name: name, DefaultCategoryID: nullID(defaultCategoryID), DefaultPaymentMode: nullID(defaultPaymentMode), ID: id,
	}); err != nil {
		if isUnique(err) {
			return Payee{}, ErrDuplicate
		}
		return Payee{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes a payee. (Transaction reassignment is added when transactions
// land in a later issue; nothing references payees yet.)
func (s *Service) Delete(ctx context.Context, walletID, id int64) error {
	p, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if p.WalletID != walletID {
		return ErrNotFound
	}
	return s.q.DeletePayee(ctx, id)
}

// Merge reassigns everything pointing at source to target, then deletes source.
func (s *Service) Merge(ctx context.Context, walletID, sourceID, targetID int64) error {
	if sourceID == targetID {
		return ErrSelfReference
	}
	source, err := s.Get(ctx, sourceID)
	if err != nil {
		return err
	}
	target, err := s.Get(ctx, targetID)
	if err != nil {
		return ErrBadTarget
	}
	if source.WalletID != walletID || target.WalletID != walletID {
		return ErrBadTarget
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	if err := qtx.ReassignTransactionPayee(ctx, db.ReassignTransactionPayeeParams{
		PayeeID: sql.NullInt64{Int64: targetID, Valid: true}, PayeeID_2: sql.NullInt64{Int64: sourceID, Valid: true},
	}); err != nil {
		return err
	}
	// Future: reassign assignments.set_payee_id (#19).
	if err := qtx.DeletePayee(ctx, sourceID); err != nil {
		return err
	}
	return tx.Commit()
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
