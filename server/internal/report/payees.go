package report

import (
	"context"
	"sort"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// PayeeActivity is what one payee holds: its transactions in a period, their
// sum in the base currency, the date of its latest transaction, and what it
// usually is — the category and the payment mode it is most often given
// (#554). The page offers the usual category as its default only when it
// holds enough of the payee's transactions; that rule is the page's.
type PayeeActivity struct {
	PayeeID int64 `json:"payeeId"`
	Count   int64 `json:"count"`
	Amount  int64 `json:"amount"`
	// LastDate is the latest transaction on or before the period's end,
	// however long ago.
	LastDate string `json:"lastDate"`
	// UsualCategoryID is the category most of its plain transactions in the
	// period went to, with how many did, out of CategorisedCount.
	UsualCategoryID    *int64 `json:"usualCategoryId,omitempty"`
	UsualCategoryCount int64  `json:"usualCategoryCount"`
	CategorisedCount   int64  `json:"categorisedCount"`
	// UsualPaymentMode is the payment mode it was most often paid with in the
	// period, "none" aside.
	UsualPaymentMode *int64 `json:"usualPaymentMode,omitempty"`
}

// PayeeActivityResult covers every payee that has ever had a transaction up to
// the period's end; one that never had any is absent.
type PayeeActivityResult struct {
	From     string          `json:"from"`
	To       string          `json:"to"`
	Payees   []PayeeActivity `json:"payees"`
	Currency *CurrencyInfo   `json:"currency"`
}

// PayeeActivity sums each payee's transactions between from and to (civil
// dates, both included), and finds what each is usually given.
func (s *Service) PayeeActivity(ctx context.Context, walletID int64, from, to string) (PayeeActivityResult, error) {
	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return PayeeActivityResult{}, err
	}
	rows, err := s.q.PayeeActivity(ctx, db.PayeeActivityParams{FromDate: from, WalletID: walletID, ToDate: to})
	if err != nil {
		return PayeeActivityResult{}, err
	}
	byID := map[int64]*PayeeActivity{}
	for _, r := range rows {
		if !r.PayeeID.Valid {
			continue
		}
		a, ok := byID[r.PayeeID.Int64]
		if !ok {
			a = &PayeeActivity{PayeeID: r.PayeeID.Int64}
			byID[r.PayeeID.Int64] = a
		}
		total := r.Total
		if base != nil {
			total = convertToBase(total, curByID[r.CurrencyID], *base)
		}
		a.Count += r.TxnCount
		a.Amount += total
		if r.LastDate > a.LastDate {
			a.LastDate = r.LastDate
		}
	}

	cats, err := s.q.PayeeCategoryCounts(ctx, db.PayeeCategoryCountsParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return PayeeActivityResult{}, err
	}
	for _, r := range cats {
		a := byID[r.PayeeID.Int64]
		if a == nil || !r.CategoryID.Valid {
			continue
		}
		a.CategorisedCount += r.TxnCount
		// The most used; on a tie, the lower id, so the answer is stable.
		if a.UsualCategoryID == nil || r.TxnCount > a.UsualCategoryCount ||
			(r.TxnCount == a.UsualCategoryCount && r.CategoryID.Int64 < *a.UsualCategoryID) {
			id := r.CategoryID.Int64
			a.UsualCategoryID = &id
			a.UsualCategoryCount = r.TxnCount
		}
	}

	modes, err := s.q.PayeePaymentCounts(ctx, db.PayeePaymentCountsParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return PayeeActivityResult{}, err
	}
	best := map[int64]int64{}
	for _, r := range modes {
		a := byID[r.PayeeID.Int64]
		if a == nil {
			continue
		}
		if a.UsualPaymentMode == nil || r.TxnCount > best[a.PayeeID] ||
			(r.TxnCount == best[a.PayeeID] && r.PaymentMode < *a.UsualPaymentMode) {
			m := r.PaymentMode
			a.UsualPaymentMode = &m
			best[a.PayeeID] = r.TxnCount
		}
	}

	out := PayeeActivityResult{From: from, To: to, Payees: make([]PayeeActivity, 0, len(byID)), Currency: currencyInfo(base)}
	for _, a := range byID {
		out.Payees = append(out.Payees, *a)
	}
	sort.Slice(out.Payees, func(i, j int) bool { return out.Payees[i].PayeeID < out.Payees[j].PayeeID })
	return out, nil
}
