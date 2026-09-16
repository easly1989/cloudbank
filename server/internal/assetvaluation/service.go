// Package assetvaluation implements dated valuations for asset accounts: a
// recorded value over time (in the account's currency) whose latest entry stands
// in for the account's transaction balance when computing net worth. Only
// asset/investment accounts can hold valuations.
package assetvaluation

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors (the HTTP layer maps these to status codes).
var (
	ErrNotFound = errors.New("assetvaluation: not found")
	ErrNotAsset = errors.New("assetvaluation: account is not an asset account")
	ErrInvalid  = errors.New("assetvaluation: a date and a non-negative value are required")
)

// Valuation is a recorded value of an asset account on a given date.
type Valuation struct {
	ID        int64  `json:"id"`
	AccountID int64  `json:"accountId"`
	Date      string `json:"date"`
	Value     int64  `json:"value"`
	Note      string `json:"note"`
}

// Input is the editable part of a valuation.
type Input struct {
	Date  string
	Value int64
	Note  string
}

func toValuation(v db.AssetValuation) Valuation {
	return Valuation{ID: v.ID, AccountID: v.AccountID, Date: v.Date, Value: v.Value, Note: v.Note}
}

// IsAssetType reports whether an account type tracks a valuation instead of a
// pure transaction balance.
func IsAssetType(t string) bool { return t == "asset" || t == "investment" }

// Service implements valuation CRUD for asset accounts.
type Service struct {
	q  *db.Queries // write pool (mutations)
	rq *db.Queries // read pool (read-only methods)
}

// NewService backs both pools with the write connection.
func NewService(write *sql.DB) *Service { return &Service{q: db.New(write), rq: db.New(write)} }

// NewServiceWithRead runs read-only methods on the read pool.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{q: db.New(write), rq: db.New(read)}
}

func validate(in Input) error {
	if strings.TrimSpace(in.Date) == "" || in.Value < 0 {
		return ErrInvalid
	}
	return nil
}

// assetAccount confirms the account belongs to the wallet and is an asset account.
func (s *Service) assetAccount(ctx context.Context, walletID, accountID int64) error {
	a, err := s.q.GetAccount(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && a.WalletID != walletID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !IsAssetType(a.Type) {
		return ErrNotAsset
	}
	return nil
}

// List returns an asset account's valuations, newest first.
func (s *Service) List(ctx context.Context, walletID, accountID int64) ([]Valuation, error) {
	if err := s.assetAccount(ctx, walletID, accountID); err != nil {
		return nil, err
	}
	rows, err := s.rq.ListValuationsForAccount(ctx, accountID)
	if err != nil {
		return nil, err
	}
	out := make([]Valuation, 0, len(rows))
	for _, v := range rows {
		out = append(out, toValuation(v))
	}
	return out, nil
}

// Add records a valuation for an asset account.
func (s *Service) Add(ctx context.Context, walletID, accountID int64, in Input) (Valuation, error) {
	if err := s.assetAccount(ctx, walletID, accountID); err != nil {
		return Valuation{}, err
	}
	if err := validate(in); err != nil {
		return Valuation{}, err
	}
	v, err := s.q.InsertValuation(ctx, db.InsertValuationParams{
		AccountID: accountID, Date: strings.TrimSpace(in.Date), Value: in.Value, Note: strings.TrimSpace(in.Note),
	})
	if err != nil {
		return Valuation{}, err
	}
	return toValuation(v), nil
}

// valuationInWallet loads a valuation and confirms its account is in the wallet
// (and still an asset account).
func (s *Service) valuationInWallet(ctx context.Context, walletID, id int64) (db.AssetValuation, error) {
	v, err := s.q.GetValuation(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return db.AssetValuation{}, ErrNotFound
	}
	if err != nil {
		return db.AssetValuation{}, err
	}
	if err := s.assetAccount(ctx, walletID, v.AccountID); err != nil {
		return db.AssetValuation{}, err
	}
	return v, nil
}

// Update edits a valuation.
func (s *Service) Update(ctx context.Context, walletID, id int64, in Input) (Valuation, error) {
	v, err := s.valuationInWallet(ctx, walletID, id)
	if err != nil {
		return Valuation{}, err
	}
	if err := validate(in); err != nil {
		return Valuation{}, err
	}
	if err := s.q.UpdateValuation(ctx, db.UpdateValuationParams{
		Date: strings.TrimSpace(in.Date), Value: in.Value, Note: strings.TrimSpace(in.Note), ID: v.ID,
	}); err != nil {
		return Valuation{}, err
	}
	return Valuation{ID: v.ID, AccountID: v.AccountID, Date: strings.TrimSpace(in.Date), Value: in.Value, Note: strings.TrimSpace(in.Note)}, nil
}

// Delete removes a valuation.
func (s *Service) Delete(ctx context.Context, walletID, id int64) error {
	v, err := s.valuationInWallet(ctx, walletID, id)
	if err != nil {
		return err
	}
	return s.q.DeleteValuation(ctx, v.ID)
}
