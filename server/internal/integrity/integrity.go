// Package integrity runs data-consistency checks over a wallet and offers safe
// automatic fixes for the issues that have an unambiguous resolution.
package integrity

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Issue types.
const (
	TypeSplitSum         = "split_sum"
	TypeOrphanTransfer   = "orphan_transfer_leg"
	TypeCategorySign     = "category_sign"
	TypeFutureReconciled = "future_reconciled"
)

// Issue is one category of anomaly found in a wallet.
type Issue struct {
	Type        string  `json:"type"`
	Description string  `json:"description"`
	Suggestion  string  `json:"suggestion"`
	Count       int     `json:"count"`
	IDs         []int64 `json:"ids"`
	Fixable     bool    `json:"fixable"`
}

// Service runs integrity checks against the database.
type Service struct {
	db   *sql.DB // write pool (fixes)
	read *sql.DB // read pool (checks)
}

// NewService builds an integrity Service backed by the write connection pool for
// both checks and fixes.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, read: write}
}

// NewServiceWithRead builds a Service whose read-only checks run on the read
// pool while fixes use the single write connection.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{db: write, read: read}
}

func (s *Service) ids(ctx context.Context, query string, args ...any) ([]int64, error) {
	rows, err := s.read.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

const (
	qSplitSum = `
SELECT t.id FROM transactions t
WHERE t.wallet_id = ? AND t.is_split = 1
  AND t.amount <> (SELECT COALESCE(SUM(s.amount), 0) FROM splits s WHERE s.transaction_id = t.id)
ORDER BY t.id`

	qOrphanTransfer = `
SELECT t.id FROM transactions t
WHERE t.wallet_id = ? AND t.payment_mode = 5
  AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.txn_from_id = t.id OR tr.txn_to_id = t.id)
ORDER BY t.id`

	qCategorySign = `
SELECT t.id FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.wallet_id = ? AND t.is_split = 0 AND t.payment_mode <> 5 AND t.amount <> 0
  AND ((c.is_income = 1 AND t.amount < 0) OR (c.is_income = 0 AND t.amount > 0))
ORDER BY t.id`

	qFutureReconciled = `
SELECT t.id FROM transactions t
WHERE t.wallet_id = ? AND t.status = 2 AND t.date > ?
ORDER BY t.id`
)

// Check runs every consistency check and returns the issues found (empty when
// the wallet is healthy).
func (s *Service) Check(ctx context.Context, walletID int64) ([]Issue, error) {
	today := time.Now().UTC().Format("2006-01-02")
	issues := make([]Issue, 0)

	add := func(typ, desc, sugg string, fixable bool, ids []int64) {
		if len(ids) == 0 {
			return
		}
		issues = append(issues, Issue{
			Type: typ, Description: desc, Suggestion: sugg, Count: len(ids), IDs: ids, Fixable: fixable,
		})
	}

	splitIDs, err := s.ids(ctx, qSplitSum, walletID)
	if err != nil {
		return nil, err
	}
	add(TypeSplitSum, "split transactions whose split lines do not sum to the transaction amount",
		"open each transaction and correct its split lines", false, splitIDs)

	orphanIDs, err := s.ids(ctx, qOrphanTransfer, walletID)
	if err != nil {
		return nil, err
	}
	add(TypeOrphanTransfer, "transfer legs that are no longer paired with another transaction",
		"review these transactions and recreate the transfer or change their payment mode", false, orphanIDs)

	catIDs, err := s.ids(ctx, qCategorySign, walletID)
	if err != nil {
		return nil, err
	}
	add(TypeCategorySign, "transactions whose amount sign disagrees with their category type (income vs expense)",
		"re-categorise the transaction or correct the amount sign", false, catIDs)

	futureIDs, err := s.ids(ctx, qFutureReconciled, walletID, today)
	if err != nil {
		return nil, err
	}
	add(TypeFutureReconciled, "transactions marked reconciled but dated in the future",
		"downgrade them to cleared (this fix is applied automatically)", true, futureIDs)

	return issues, nil
}

// Fix applies the automatic remedy for a fixable issue type and returns the
// number of rows changed. Only future-reconciled is auto-fixable (downgraded to
// cleared); other types require manual review.
func (s *Service) Fix(ctx context.Context, walletID int64, issueType string) (int, error) {
	switch issueType {
	case TypeFutureReconciled:
		today := time.Now().UTC().Format("2006-01-02")
		res, err := s.db.ExecContext(ctx,
			`UPDATE transactions SET status = 1 WHERE wallet_id = ? AND status = 2 AND date > ?`,
			walletID, today)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		return int(n), nil
	default:
		return 0, fmt.Errorf("issue type %q has no automatic fix", issueType)
	}
}
