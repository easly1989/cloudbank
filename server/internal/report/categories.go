package report

import (
	"context"
	"sort"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// CategoryActivity is what one category holds: its lines in a period, their
// sum in the base currency, and the date of its latest line (#552). A split
// counts once per line, under the line's own category.
type CategoryActivity struct {
	CategoryID int64 `json:"categoryId"`
	Count      int64 `json:"count"`
	Amount     int64 `json:"amount"`
	// LastDate is the latest line on or before the period's end, however long
	// ago: "not used since" needs it when the period itself holds nothing.
	LastDate string `json:"lastDate"`
}

// CategoryActivityResult covers every category that has ever had a line up to
// the period's end; one that never had any is absent.
type CategoryActivityResult struct {
	From       string             `json:"from"`
	To         string             `json:"to"`
	Categories []CategoryActivity `json:"categories"`
	Currency   *CurrencyInfo      `json:"currency"`
}

// CategoryActivity sums each category's lines between from and to (civil
// dates, both included). Unlike the statistics it keeps the categories hidden
// from the reports: the categories page lists them all.
func (s *Service) CategoryActivity(ctx context.Context, walletID int64, from, to string) (CategoryActivityResult, error) {
	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return CategoryActivityResult{}, err
	}
	rows, err := s.q.CategoryActivity(ctx, db.CategoryActivityParams{FromDate: from, WalletID: walletID, ToDate: to})
	if err != nil {
		return CategoryActivityResult{}, err
	}
	byID := map[int64]*CategoryActivity{}
	for _, r := range rows {
		if !r.CategoryID.Valid {
			continue
		}
		a, ok := byID[r.CategoryID.Int64]
		if !ok {
			a = &CategoryActivity{CategoryID: r.CategoryID.Int64}
			byID[r.CategoryID.Int64] = a
		}
		total := r.Total
		if base != nil {
			total = convertToBase(total, curByID[r.CurrencyID], *base)
		}
		a.Count += r.LineCount
		a.Amount += total
		if r.LastDate > a.LastDate {
			a.LastDate = r.LastDate
		}
	}
	out := CategoryActivityResult{From: from, To: to, Categories: make([]CategoryActivity, 0, len(byID)), Currency: currencyInfo(base)}
	for _, a := range byID {
		out.Categories = append(out.Categories, *a)
	}
	sort.Slice(out.Categories, func(i, j int) bool { return out.Categories[i].CategoryID < out.Categories[j].CategoryID })
	return out, nil
}
