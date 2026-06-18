package assignment

import (
	"context"
	"database/sql"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// ErrNotFound is returned when a rule does not exist (engine ErrInvalid* errors
// are reused for validation).
var ErrNotFound = errors.New("assignment: not found")

// Definition is the public representation of a rule (config only).
type Definition struct {
	ID             int64  `json:"id"`
	Position       int    `json:"position"`
	MatchField     string `json:"matchField"`
	MatchType      string `json:"matchType"`
	Pattern        string `json:"pattern"`
	CaseSensitive  bool   `json:"caseSensitive"`
	SetPayeeID     *int64 `json:"setPayeeId,omitempty"`
	SetCategoryID  *int64 `json:"setCategoryId,omitempty"`
	SetPaymentMode *int   `json:"setPaymentMode,omitempty"`
	ApplyOnManual  bool   `json:"applyOnManual"`
	ApplyOnImport  bool   `json:"applyOnImport"`
}

// Input carries the editable fields of a rule.
type Input struct {
	MatchField     string
	MatchType      string
	Pattern        string
	CaseSensitive  bool
	SetPayeeID     *int64
	SetCategoryID  *int64
	SetPaymentMode *int
	ApplyOnManual  bool
	ApplyOnImport  bool
}

// MatchedTransaction is a transaction surfaced by the rule tester.
type MatchedTransaction struct {
	ID        int64  `json:"id"`
	AccountID int64  `json:"accountId"`
	Date      string `json:"date"`
	Memo      string `json:"memo"`
	PayeeName string `json:"payeeName"`
}

// Service implements rule management and application.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

func (in Input) toRule() Rule {
	return Rule{
		Field: in.MatchField, Type: in.MatchType, Pattern: in.Pattern, CaseSensitive: in.CaseSensitive,
		SetPayeeID: in.SetPayeeID, SetCategoryID: in.SetCategoryID, SetPaymentMode: in.SetPaymentMode,
	}
}

func nullID(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func nullInt(p *int) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*p), Valid: true}
}

func idPtr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func intPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func toDefinition(a db.Assignment) Definition {
	return Definition{
		ID: a.ID, Position: int(a.Position), MatchField: a.MatchField, MatchType: a.MatchType,
		Pattern: a.Pattern, CaseSensitive: a.CaseSensitive != 0,
		SetPayeeID: idPtr(a.SetPayeeID), SetCategoryID: idPtr(a.SetCategoryID),
		SetPaymentMode: intPtr(a.SetPaymentMode),
		ApplyOnManual:  a.ApplyOnManual != 0, ApplyOnImport: a.ApplyOnImport != 0,
	}
}

func toEngineRule(a db.Assignment) Rule {
	return Rule{
		ID: a.ID, Field: a.MatchField, Type: a.MatchType, Pattern: a.Pattern,
		CaseSensitive: a.CaseSensitive != 0, SetPayeeID: idPtr(a.SetPayeeID),
		SetCategoryID: idPtr(a.SetCategoryID), SetPaymentMode: intPtr(a.SetPaymentMode),
	}
}

// Create validates and stores a new rule (appended at the end).
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Definition, error) {
	rule := in.toRule()
	if err := rule.Compile(); err != nil {
		return Definition{}, err
	}
	pos, err := s.q.NextAssignmentPosition(ctx, walletID)
	if err != nil {
		return Definition{}, err
	}
	row, err := s.q.InsertAssignment(ctx, db.InsertAssignmentParams{
		WalletID: walletID, Position: pos, MatchField: in.MatchField, MatchType: in.MatchType,
		Pattern: in.Pattern, CaseSensitive: b2i(in.CaseSensitive), SetPayeeID: nullID(in.SetPayeeID),
		SetCategoryID: nullID(in.SetCategoryID), SetPaymentMode: nullInt(in.SetPaymentMode),
		ApplyOnManual: b2i(in.ApplyOnManual), ApplyOnImport: b2i(in.ApplyOnImport),
	})
	if err != nil {
		return Definition{}, err
	}
	return toDefinition(row), nil
}

// Get returns one rule.
func (s *Service) Get(ctx context.Context, id int64) (Definition, error) {
	a, err := s.q.GetAssignment(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Definition{}, ErrNotFound
	}
	if err != nil {
		return Definition{}, err
	}
	return toDefinition(a), nil
}

// WalletOf returns the wallet a rule belongs to (for ownership checks).
func (s *Service) WalletOf(ctx context.Context, id int64) (int64, error) {
	a, err := s.q.GetAssignment(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return a.WalletID, nil
}

// List returns a wallet's rules in match order.
func (s *Service) List(ctx context.Context, walletID int64) ([]Definition, error) {
	rows, err := s.q.ListAssignmentsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Definition, 0, len(rows))
	for _, a := range rows {
		out = append(out, toDefinition(a))
	}
	return out, nil
}

// Update validates and replaces a rule's configuration.
func (s *Service) Update(ctx context.Context, id int64, in Input) (Definition, error) {
	rule := in.toRule()
	if err := rule.Compile(); err != nil {
		return Definition{}, err
	}
	if err := s.q.UpdateAssignment(ctx, db.UpdateAssignmentParams{
		MatchField: in.MatchField, MatchType: in.MatchType, Pattern: in.Pattern,
		CaseSensitive: b2i(in.CaseSensitive), SetPayeeID: nullID(in.SetPayeeID),
		SetCategoryID: nullID(in.SetCategoryID), SetPaymentMode: nullInt(in.SetPaymentMode),
		ApplyOnManual: b2i(in.ApplyOnManual), ApplyOnImport: b2i(in.ApplyOnImport), ID: id,
	}); err != nil {
		return Definition{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes a rule.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.q.DeleteAssignment(ctx, id)
}

// Reorder sets each rule's position from the given id order (first-match-wins).
func (s *Service) Reorder(ctx context.Context, walletID int64, ids []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	for pos, id := range ids {
		if err := qtx.SetAssignmentPosition(ctx, db.SetAssignmentPositionParams{
			Position: int64(pos), ID: id, WalletID: walletID,
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// rules loads the wallet's rules and compiles them for matching.
func (s *Service) rules(ctx context.Context, walletID int64, manualOnly bool) ([]Rule, error) {
	rows, err := s.q.ListAssignmentsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Rule, 0, len(rows))
	for _, a := range rows {
		if manualOnly && a.ApplyOnManual == 0 {
			continue
		}
		r := toEngineRule(a)
		if err := r.Compile(); err != nil {
			continue // skip a rule that somehow no longer compiles
		}
		out = append(out, r)
	}
	return out, nil
}

// Suggest returns the assignments of the first apply-on-manual rule that matches
// the memo/payee (used by the entry form).
func (s *Service) Suggest(ctx context.Context, walletID int64, memo, payee string) (Result, bool, error) {
	rules, err := s.rules(ctx, walletID, true)
	if err != nil {
		return Result{}, false, err
	}
	res, ok := FirstMatch(rules, memo, payee)
	return res, ok, nil
}

// ImportRules returns the compiled apply-on-import rules for the wallet, in
// priority order. The file importers use them to auto-categorise rows.
func (s *Service) ImportRules(ctx context.Context, walletID int64) ([]Rule, error) {
	rows, err := s.q.ListAssignmentsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Rule, 0, len(rows))
	for _, a := range rows {
		if a.ApplyOnImport == 0 {
			continue
		}
		r := toEngineRule(a)
		if err := r.Compile(); err != nil {
			continue // skip a rule that somehow no longer compiles
		}
		out = append(out, r)
	}
	return out, nil
}

// MatchRow applies the first matching rule (from ImportRules) to a memo/payee
// pair and returns the assignment to apply, if any. It is a thin convenience
// wrapper around FirstMatch for the importers.
func MatchRow(rules []Rule, memo, payee string) (Result, bool) {
	return FirstMatch(rules, memo, payee)
}

// Test compiles a candidate rule and returns up to `limit` existing transactions
// it would match (the "which transactions would match" preview).
func (s *Service) Test(ctx context.Context, walletID int64, in Input, limit int) ([]MatchedTransaction, error) {
	rule := in.toRule()
	if err := rule.Compile(); err != nil {
		return nil, err
	}
	rows, err := s.q.ListWalletTransactionsForRules(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]MatchedTransaction, 0)
	for _, r := range rows {
		if rule.Matches(r.Memo, r.PayeeName) {
			out = append(out, MatchedTransaction{
				ID: r.ID, AccountID: r.AccountID, Date: r.Date, Memo: r.Memo, PayeeName: r.PayeeName,
			})
			if limit > 0 && len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

// ApplyToExisting runs every rule over the wallet's transactions (optionally a
// single account) and applies the first match to each. When onlyFillEmpty is
// true, a field is set only if currently empty. Returns the number of
// transactions changed; the whole batch is one transaction.
func (s *Service) ApplyToExisting(ctx context.Context, walletID int64, accountID *int64, onlyFillEmpty bool) (int, error) {
	rules, err := s.rules(ctx, walletID, false)
	if err != nil {
		return 0, err
	}
	if len(rules) == 0 {
		return 0, nil
	}
	rows, err := s.q.ListWalletTransactionsForRules(ctx, walletID)
	if err != nil {
		return 0, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	changed := 0
	for _, r := range rows {
		if accountID != nil && r.AccountID != *accountID {
			continue
		}
		res, ok := FirstMatch(rules, r.Memo, r.PayeeName)
		if !ok {
			continue
		}
		touched := false
		if res.PayeeID != nil && (!onlyFillEmpty || !r.PayeeID.Valid) {
			if err := qtx.SetTransactionPayee(ctx, db.SetTransactionPayeeParams{PayeeID: nullID(res.PayeeID), ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		if res.CategoryID != nil && (!onlyFillEmpty || !r.CategoryID.Valid) {
			if err := qtx.SetTransactionCategory(ctx, db.SetTransactionCategoryParams{CategoryID: nullID(res.CategoryID), ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		if res.PaymentMode != nil && (!onlyFillEmpty || r.PaymentMode == 0) {
			if err := qtx.SetTransactionPaymentMode(ctx, db.SetTransactionPaymentModeParams{PaymentMode: int64(*res.PaymentMode), ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		if touched {
			changed++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return changed, nil
}
