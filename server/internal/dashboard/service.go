// Package dashboard aggregates a wallet's accounts, balances and spending into
// the home-screen overview: per-account bank/today/future balances (matching
// the register header), base-currency grand totals, and a top-categories
// breakdown for a date range.
package dashboard

import (
	"context"
	"database/sql"
	"math"
	"sort"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

const dateLayout = "2006-01-02"

// topCategoryLimit is how many named slices the donut shows before the rest are
// rolled into "Other".
const topCategoryLimit = 8

// CurrencyInfo carries the formatting metadata the UI needs to render an amount.
type CurrencyInfo struct {
	Code         string `json:"code"`
	Symbol       string `json:"symbol"`
	SymbolPrefix bool   `json:"symbolPrefix"`
	DecimalChar  string `json:"decimalChar"`
	GroupChar    string `json:"groupChar"`
	FracDigits   int    `json:"fracDigits"`
}

// AccountSummary is one account's headline balances in its own currency.
type AccountSummary struct {
	ID         int64        `json:"id"`
	Name       string       `json:"name"`
	Type       string       `json:"type"`
	GroupName  string       `json:"groupName"`
	Closed     bool         `json:"closed"`
	NoSummary  bool         `json:"noSummary"`
	Bank       int64        `json:"bank"`
	Today      int64        `json:"today"`
	Future     int64        `json:"future"`
	Currency   CurrencyInfo `json:"currency"`
	CurrencyID int64        `json:"currencyId"`
}

// Totals are wallet-wide balances converted to the base currency (excludes
// closed and no-summary accounts).
type Totals struct {
	Bank   int64 `json:"bank"`
	Today  int64 `json:"today"`
	Future int64 `json:"future"`
}

// CategorySlice is one slice of the spending donut (positive magnitude, base
// currency).
type CategorySlice struct {
	CategoryID int64  `json:"categoryId"`
	Name       string `json:"name"`
	Amount     int64  `json:"amount"`
}

// Data is the full dashboard payload.
type Data struct {
	Accounts      []AccountSummary `json:"accounts"`
	Totals        Totals           `json:"totals"`
	BaseCurrency  *CurrencyInfo    `json:"baseCurrency"`
	TopCategories []CategorySlice  `json:"topCategories"`
	From          string           `json:"from"`
	To            string           `json:"to"`
	// Upcoming is a placeholder until the scheduler lands (always empty for now).
	Upcoming []any `json:"upcoming"`
}

// Service builds dashboards.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// Build assembles the dashboard for a wallet over [from, to] (used by the
// spending donut; the balances are point-in-time, not range-bound).
func (s *Service) Build(ctx context.Context, walletID int64, from, to string) (Data, error) {
	today := time.Now().UTC().Format(dateLayout)

	accounts, err := s.q.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return Data{}, err
	}
	deltas, err := s.q.AccountBalanceDeltas(ctx, db.AccountBalanceDeltasParams{Today: today, WalletID: walletID})
	if err != nil {
		return Data{}, err
	}
	deltaByAccount := make(map[int64]db.AccountBalanceDeltasRow, len(deltas))
	for _, d := range deltas {
		deltaByAccount[d.AccountID] = d
	}

	currencies, err := s.q.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return Data{}, err
	}
	curByID := make(map[int64]db.Currency, len(currencies))
	var base *db.Currency
	for i := range currencies {
		curByID[currencies[i].ID] = currencies[i]
		if currencies[i].IsBase != 0 {
			base = &currencies[i]
		}
	}

	out := Data{From: from, To: to, Upcoming: []any{}, TopCategories: []CategorySlice{}}
	var totals Totals
	for _, a := range accounts {
		d := deltaByAccount[a.ID]
		sum := AccountSummary{
			ID: a.ID, Name: a.Name, Type: a.Type, GroupName: a.GroupName,
			Closed: a.Closed != 0, NoSummary: a.NoSummary != 0, CurrencyID: a.CurrencyID,
			Bank:   a.InitialBalance + d.BankDelta,
			Today:  a.InitialBalance + d.TodayDelta,
			Future: a.InitialBalance + d.FutureDelta,
			Currency: CurrencyInfo{
				Code: a.CurrencyCode, Symbol: a.CurrencySymbol, SymbolPrefix: a.CurrencySymbolPrefix != 0,
				DecimalChar: a.CurrencyDecimalChar, GroupChar: a.CurrencyGroupChar, FracDigits: int(a.CurrencyFracDigits),
			},
		}
		out.Accounts = append(out.Accounts, sum)
		if base != nil && !sum.Closed && !sum.NoSummary {
			totals.Bank += convertToBase(sum.Bank, curByID[a.CurrencyID], *base)
			totals.Today += convertToBase(sum.Today, curByID[a.CurrencyID], *base)
			totals.Future += convertToBase(sum.Future, curByID[a.CurrencyID], *base)
		}
	}
	out.Totals = totals
	if base != nil {
		out.BaseCurrency = &CurrencyInfo{
			Code: base.IsoCode, Symbol: base.Symbol, SymbolPrefix: base.SymbolPrefix != 0,
			DecimalChar: base.DecimalChar, GroupChar: base.GroupChar, FracDigits: int(base.FracDigits),
		}
		cats, err := s.topCategories(ctx, walletID, from, to, curByID, *base)
		if err != nil {
			return Data{}, err
		}
		out.TopCategories = cats
	}
	return out, nil
}

func (s *Service) topCategories(ctx context.Context, walletID int64, from, to string, curByID map[int64]db.Currency, base db.Currency) ([]CategorySlice, error) {
	rows, err := s.q.CategoryExpenseTotals(ctx, db.CategoryExpenseTotalsParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return nil, err
	}
	categories, err := s.q.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	parentOf := make(map[int64]sql.NullInt64, len(categories))
	nameOf := make(map[int64]string, len(categories))
	for _, c := range categories {
		parentOf[c.ID] = c.ParentID
		nameOf[c.ID] = c.Name
	}

	// Roll subcategory spending up to the top-level category; keep only expenses.
	byParent := make(map[int64]int64)
	for _, r := range rows {
		if !r.CategoryID.Valid {
			continue
		}
		baseAmount := convertToBase(r.Amount, curByID[r.CurrencyID], base)
		if baseAmount >= 0 {
			continue // income / zero: not "where money goes"
		}
		top := r.CategoryID.Int64
		if p := parentOf[top]; p.Valid {
			top = p.Int64
		}
		byParent[top] += -baseAmount
	}

	slices := make([]CategorySlice, 0, len(byParent))
	for id, amount := range byParent {
		slices = append(slices, CategorySlice{CategoryID: id, Name: nameOf[id], Amount: amount})
	}
	sort.Slice(slices, func(i, j int) bool {
		if slices[i].Amount != slices[j].Amount {
			return slices[i].Amount > slices[j].Amount
		}
		return slices[i].CategoryID < slices[j].CategoryID
	})
	if len(slices) > topCategoryLimit {
		var other int64
		for _, sl := range slices[topCategoryLimit:] {
			other += sl.Amount
		}
		slices = slices[:topCategoryLimit]
		slices = append(slices, CategorySlice{CategoryID: 0, Name: "", Amount: other})
	}
	return slices, nil
}

// convertToBase converts a minor-unit amount in cur to base-currency minor
// units: decimal value × rate, adjusted for differing fractional digits.
// Display-only aggregation, so float rounding (half away from zero) is fine.
func convertToBase(amount int64, cur, base db.Currency) int64 {
	if cur.ID == base.ID || cur.ID == 0 {
		return amount
	}
	scaled := float64(amount) * cur.Rate * math.Pow10(int(base.FracDigits)-int(cur.FracDigits))
	return int64(math.Round(scaled))
}
