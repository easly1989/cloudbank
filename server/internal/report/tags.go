package report

import (
	"context"
	"sort"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// maxTagCategories is how many of a tag's categories the tags page shows.
const maxTagCategories = 2

// TagCategory is one of the categories a tag's transactions went to, and how
// many of them did.
type TagCategory struct {
	CategoryID int64 `json:"categoryId"`
	Count      int64 `json:"count"`
}

// TagActivity is what one tag holds: its transactions in a period, their net
// sum in the base currency (money in and out together, as the reports by tag
// add them), the date of its latest transaction, and the categories they
// mostly went to (#556).
type TagActivity struct {
	TagID  int64 `json:"tagId"`
	Count  int64 `json:"count"`
	Amount int64 `json:"amount"`
	// LastDate is the latest transaction on or before the period's end,
	// however long ago.
	LastDate string `json:"lastDate"`
	// Categories are the most frequent first, at most two: a split counts
	// once per line.
	Categories []TagCategory `json:"categories"`
}

// TagActivityResult covers every tag that has ever been on a transaction up to
// the period's end; one that never was is absent.
type TagActivityResult struct {
	From     string        `json:"from"`
	To       string        `json:"to"`
	Tags     []TagActivity `json:"tags"`
	Currency *CurrencyInfo `json:"currency"`
}

// TagActivity sums each tag's transactions between from and to (civil dates,
// both included), and finds the categories they mostly went to.
func (s *Service) TagActivity(ctx context.Context, walletID int64, from, to string) (TagActivityResult, error) {
	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return TagActivityResult{}, err
	}
	rows, err := s.q.TagActivity(ctx, db.TagActivityParams{FromDate: from, WalletID: walletID, ToDate: to})
	if err != nil {
		return TagActivityResult{}, err
	}
	byID := map[int64]*TagActivity{}
	for _, r := range rows {
		a, ok := byID[r.TagID]
		if !ok {
			a = &TagActivity{TagID: r.TagID, Categories: []TagCategory{}}
			byID[r.TagID] = a
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

	cats, err := s.q.TagCategoryCounts(ctx, db.TagCategoryCountsParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return TagActivityResult{}, err
	}
	counts := map[int64]map[int64]int64{}
	for _, r := range cats {
		if byID[r.TagID] == nil || !r.CategoryID.Valid {
			continue
		}
		if counts[r.TagID] == nil {
			counts[r.TagID] = map[int64]int64{}
		}
		counts[r.TagID][r.CategoryID.Int64] += r.TxnCount
	}
	for tagID, m := range counts {
		list := make([]TagCategory, 0, len(m))
		for id, n := range m {
			list = append(list, TagCategory{CategoryID: id, Count: n})
		}
		// The most frequent first; on a tie, the lower id, so the answer is stable.
		sort.Slice(list, func(i, j int) bool {
			if list[i].Count != list[j].Count {
				return list[i].Count > list[j].Count
			}
			return list[i].CategoryID < list[j].CategoryID
		})
		if len(list) > maxTagCategories {
			list = list[:maxTagCategories]
		}
		byID[tagID].Categories = list
	}

	out := TagActivityResult{From: from, To: to, Tags: make([]TagActivity, 0, len(byID)), Currency: currencyInfo(base)}
	for _, a := range byID {
		out.Tags = append(out.Tags, *a)
	}
	sort.Slice(out.Tags, func(i, j int) bool { return out.Tags[i].TagID < out.Tags[j].TagID })
	return out, nil
}
