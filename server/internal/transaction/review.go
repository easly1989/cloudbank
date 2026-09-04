package transaction

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// duplicateFinderWindowDays bounds how far apart two same-account/same-amount
// transactions may be dated and still be surfaced as a possible duplicate. Wider
// than the bank-sync auto-match window so hand-entered rows with a wrong date are
// caught; a false positive is dismissed once and never shown again.
const duplicateFinderWindowDays = 14

// ReviewTxn is the lightweight transaction shape the review surfaces: enough to
// judge a duplicate or complete a category, including the import ref so the
// bank-sourced row is distinguishable.
type ReviewTxn struct {
	ID         int64  `json:"id"`
	AccountID  int64  `json:"accountId"`
	Date       string `json:"date"`
	Amount     int64  `json:"amount"`
	Memo       string `json:"memo"`
	PayeeID    *int64 `json:"payeeId,omitempty"`
	CategoryID *int64 `json:"categoryId,omitempty"`
	Status     int    `json:"status"`
	ImportRef  string `json:"importRef,omitempty"`
}

// DuplicatePair is two transactions that look like the same movement.
type DuplicatePair struct {
	A ReviewTxn `json:"a"`
	B ReviewTxn `json:"b"`
}

// ReviewResult is the bank-sync review payload: imported rows still missing a
// category, and pairs of suspected duplicates (dismissed pairs excluded).
type ReviewResult struct {
	NeedsCategory []ReviewTxn     `json:"needsCategory"`
	Duplicates    []DuplicatePair `json:"duplicates"`
}

func reviewTxn(r db.Transaction) ReviewTxn {
	return ReviewTxn{
		ID: r.ID, AccountID: r.AccountID, Date: r.Date, Amount: r.Amount, Memo: r.Memo,
		PayeeID: idPtr(r.PayeeID), CategoryID: idPtr(r.CategoryID), Status: int(r.Status),
		ImportRef: r.ImportRef,
	}
}

func pairKey(a, b int64) (int64, int64) {
	if a <= b {
		return a, b
	}
	return b, a
}

// daysApart returns the absolute day difference between two YYYY-MM-DD dates, or a
// large number when either cannot be parsed (so they never pair).
func daysApart(d1, d2 string) int {
	t1, e1 := time.Parse(dateLayout, d1)
	t2, e2 := time.Parse(dateLayout, d2)
	if e1 != nil || e2 != nil {
		return 1 << 30
	}
	diff := t1.Sub(t2)
	if diff < 0 {
		diff = -diff
	}
	return int(diff.Hours() / 24)
}

// Review builds the bank-sync review: imported-but-uncategorised transactions and
// suspected duplicate pairs (same account + amount within the finder window, minus
// any pair the user has marked "not a duplicate").
func (s *Service) Review(ctx context.Context, walletID int64) (ReviewResult, error) {
	out := ReviewResult{NeedsCategory: []ReviewTxn{}, Duplicates: []DuplicatePair{}}

	uncat, err := s.rq.ListImportedUncategorized(ctx, walletID)
	if err != nil {
		return ReviewResult{}, err
	}
	for _, r := range uncat {
		out.NeedsCategory = append(out.NeedsCategory, reviewTxn(r))
	}

	rows, err := s.rq.ListPotentialDuplicates(ctx, db.ListPotentialDuplicatesParams{
		WalletID: walletID, WalletID_2: walletID,
	})
	if err != nil {
		return ReviewResult{}, err
	}
	dismissed, err := s.rq.ListDuplicateDismissals(ctx, walletID)
	if err != nil {
		return ReviewResult{}, err
	}
	skip := make(map[[2]int64]bool, len(dismissed))
	for _, d := range dismissed {
		a, b := pairKey(d.TxnAID, d.TxnBID)
		skip[[2]int64{a, b}] = true
	}

	// rows are ordered by (account, amount, date). For each row pair within the
	// same account+amount group and inside the date window, emit a suspected
	// duplicate unless it was dismissed.
	for i := 0; i < len(rows); i++ {
		for j := i + 1; j < len(rows); j++ {
			a, b := rows[i], rows[j]
			if a.AccountID != b.AccountID || a.Amount != b.Amount {
				break // ordered: the group for row i has ended
			}
			if daysApart(a.Date, b.Date) > duplicateFinderWindowDays {
				continue
			}
			ka, kb := pairKey(a.ID, b.ID)
			if skip[[2]int64{ka, kb}] {
				continue
			}
			out.Duplicates = append(out.Duplicates, DuplicatePair{A: reviewTxn(a), B: reviewTxn(b)})
		}
	}
	return out, nil
}

// DismissDuplicate records that two transactions are not duplicates, so the review
// stops surfacing the pair. Both must belong to the wallet.
func (s *Service) DismissDuplicate(ctx context.Context, walletID, aID, bID int64) error {
	for _, id := range []int64{aID, bID} {
		row, err := s.rq.GetTransaction(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
	}
	a, b := pairKey(aID, bID)
	return s.q.InsertDuplicateDismissal(ctx, db.InsertDuplicateDismissalParams{
		WalletID: walletID, TxnAID: a, TxnBID: b,
	})
}

// Merge folds one transaction of a duplicate pair into the other: the kept row
// inherits the dropped row's import ref when it has none (so a future sync
// recognises it and does not re-create the duplicate), then the dropped row is
// deleted. Both must belong to the wallet.
func (s *Service) Merge(ctx context.Context, walletID, keepID, dropID int64) error {
	if keepID == dropID {
		return ErrNotFound
	}
	keep, err := s.rq.GetTransaction(ctx, keepID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && keep.WalletID != walletID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	drop, err := s.rq.GetTransaction(ctx, dropID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && drop.WalletID != walletID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if keep.ImportRef == "" && drop.ImportRef != "" {
		if err := s.q.SetTransactionImportRef(ctx, db.SetTransactionImportRefParams{
			ImportRef: drop.ImportRef, ID: keepID, WalletID: walletID,
		}); err != nil {
			return err
		}
	}
	return s.Delete(ctx, dropID)
}
