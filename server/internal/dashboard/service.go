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

// MonthPoint is one month's income and expense (both positive magnitudes, base
// currency) for the income/expense-over-time chart.
type MonthPoint struct {
	Month   string `json:"month"` // YYYY-MM
	Income  int64  `json:"income"`
	Expense int64  `json:"expense"`
}

// Data is the full dashboard payload.
type Data struct {
	Accounts      []AccountSummary `json:"accounts"`
	Totals        Totals           `json:"totals"`
	BaseCurrency  *CurrencyInfo    `json:"baseCurrency"`
	TopCategories []CategorySlice  `json:"topCategories"`
	IncomeExpense []MonthPoint     `json:"incomeExpense"`
	From          string           `json:"from"`
	To            string           `json:"to"`
	// Upcoming is filled with the next scheduled occurrences by the HTTP layer.
	Upcoming []any `json:"upcoming"`
}

// incomeExpenseMonths is how many trailing months the income/expense chart spans.
const incomeExpenseMonths = 12

// Service builds dashboards.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// Grouping selects how the spending breakdown is bucketed.
const (
	GroupByCategory = "category"
	GroupByPayee    = "payee"
)

// Build assembles the dashboard for a wallet over [from, to] (used by the
// spending breakdown; the balances are point-in-time, not range-bound).
// groupBy buckets the breakdown by category (default) or payee.
func (s *Service) Build(ctx context.Context, walletID int64, from, to, groupBy string) (Data, error) {
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

	out := Data{From: from, To: to, Upcoming: []any{}, TopCategories: []CategorySlice{}, IncomeExpense: []MonthPoint{}}
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
		var slices []CategorySlice
		if groupBy == GroupByPayee {
			slices, err = s.topPayees(ctx, walletID, from, to, curByID, *base)
		} else {
			slices, err = s.topCategories(ctx, walletID, from, to, curByID, *base)
		}
		if err != nil {
			return Data{}, err
		}
		out.TopCategories = slices

		ie, err := s.incomeExpense(ctx, walletID, today, curByID, *base)
		if err != nil {
			return Data{}, err
		}
		out.IncomeExpense = ie
	}
	return out, nil
}

// incomeExpense buckets income (amount > 0) and expense (amount < 0) by month
// over the trailing incomeExpenseMonths window ending today, in base currency.
// Internal transfers are excluded so the totals reflect real money in and out.
func (s *Service) incomeExpense(ctx context.Context, walletID int64, today string, curByID map[int64]db.Currency, base db.Currency) ([]MonthPoint, error) {
	from, months := monthsWindow(today, incomeExpenseMonths)
	rows, err := s.q.MonthlyIncomeExpense(ctx, db.MonthlyIncomeExpenseParams{WalletID: walletID, FromDate: from, ToDate: today})
	if err != nil {
		return nil, err
	}
	type ie struct{ income, expense int64 }
	byMonth := make(map[string]*ie, len(rows))
	for _, r := range rows {
		m := byMonth[r.Month]
		if m == nil {
			m = &ie{}
			byMonth[r.Month] = m
		}
		m.income += convertToBase(r.Income, curByID[r.CurrencyID], base)
		m.expense += convertToBase(r.Expense, curByID[r.CurrencyID], base)
	}
	out := make([]MonthPoint, 0, len(months))
	for _, mk := range months {
		p := MonthPoint{Month: mk}
		if v := byMonth[mk]; v != nil {
			p.Income = v.income
			p.Expense = -v.expense // negative sum → positive magnitude
		}
		out = append(out, p)
	}
	return out, nil
}

// monthsWindow returns the first-of-month start date (YYYY-MM-DD) and the n
// consecutive month keys (YYYY-MM) ending with today's month.
func monthsWindow(today string, n int) (from string, months []string) {
	t, err := time.Parse(dateLayout, today)
	if err != nil {
		t = time.Now().UTC()
	}
	start := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -(n - 1), 0)
	months = make([]string, 0, n)
	for i := 0; i < n; i++ {
		months = append(months, start.AddDate(0, i, 0).Format("2006-01"))
	}
	return start.Format(dateLayout), months
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

	return topSlices(byParent, nameOf), nil
}

// topPayees buckets expenses by payee in a date range (split lines contribute
// via their parent transaction's payee and total amount). The returned slices
// reuse CategorySlice with CategoryID holding the payee id (0 = the rolled-up
// Other slice), so the spending widget renders payee and category breakdowns
// identically.
func (s *Service) topPayees(ctx context.Context, walletID int64, from, to string, curByID map[int64]db.Currency, base db.Currency) ([]CategorySlice, error) {
	rows, err := s.q.PayeeExpenseTotals(ctx, db.PayeeExpenseTotalsParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return nil, err
	}
	payees, err := s.q.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	nameOf := make(map[int64]string, len(payees))
	for _, p := range payees {
		nameOf[p.ID] = p.Name
	}

	byPayee := make(map[int64]int64)
	for _, r := range rows {
		if !r.PayeeID.Valid {
			continue
		}
		baseAmount := convertToBase(r.Amount, curByID[r.CurrencyID], base)
		if baseAmount >= 0 {
			continue // income / zero: not "where money goes"
		}
		byPayee[r.PayeeID.Int64] += -baseAmount
	}
	return topSlices(byPayee, nameOf), nil
}

// topSlices turns a key→amount map into the sorted top-N slices plus a rolled-up
// Other slice (CategoryID 0), shared by the category and payee breakdowns.
func topSlices(byKey map[int64]int64, nameOf map[int64]string) []CategorySlice {
	slices := make([]CategorySlice, 0, len(byKey))
	for id, amount := range byKey {
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
	return slices
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
