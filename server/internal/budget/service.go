// Package budget manages per-category monthly budgets and computes the
// budget-vs-actual report. Budgets are stored in the base currency; actuals are
// converted to it. Accounts and categories flagged no_budget are excluded.
package budget

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

const dateLayout = "2006-01-02"

// Modes.
const (
	ModeSame    = "same"
	ModeMonthly = "monthly"
)

// Errors.
var (
	ErrInvalidMode     = errors.New("budget: mode must be 'same' or 'monthly'")
	ErrInvalidCategory = errors.New("budget: category does not belong to the wallet")
)

// CurrencyInfo carries base-currency formatting for the report.
type CurrencyInfo struct {
	Code         string `json:"code"`
	Symbol       string `json:"symbol"`
	SymbolPrefix bool   `json:"symbolPrefix"`
	DecimalChar  string `json:"decimalChar"`
	GroupChar    string `json:"groupChar"`
	FracDigits   int    `json:"fracDigits"`
}

// CategoryBudget is a category's budget configuration.
type CategoryBudget struct {
	CategoryID int64     `json:"categoryId"`
	Mode       string    `json:"mode"`
	Same       int64     `json:"same"`
	Monthly    [12]int64 `json:"monthly"`
}

// Input is the editable budget for a category.
type Input struct {
	Mode    string
	Same    int64
	Monthly [12]int64
}

// ReportRow is one category line of the budget report (base currency, signed).
type ReportRow struct {
	CategoryID int64  `json:"categoryId"`
	Name       string `json:"name"`
	IsIncome   bool   `json:"isIncome"`
	Budget     int64  `json:"budget"`
	Actual     int64  `json:"actual"`
}

// Report is budget vs actual over a period.
type Report struct {
	Rows        []ReportRow   `json:"rows"`
	TotalBudget int64         `json:"totalBudget"`
	TotalActual int64         `json:"totalActual"`
	From        string        `json:"from"`
	To          string        `json:"to"`
	Rollup      bool          `json:"rollup"`
	Currency    *CurrencyInfo `json:"currency"`
}

// Service implements budget management and reporting.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// List returns every category that has a budget configured.
func (s *Service) List(ctx context.Context, walletID int64) ([]CategoryBudget, error) {
	rows, err := s.q.ListBudgetsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	byCat := map[int64]*CategoryBudget{}
	order := []int64{}
	for _, b := range rows {
		cb, ok := byCat[b.CategoryID]
		if !ok {
			cb = &CategoryBudget{CategoryID: b.CategoryID, Mode: ModeMonthly}
			byCat[b.CategoryID] = cb
			order = append(order, b.CategoryID)
		}
		if b.Month == 0 {
			cb.Mode = ModeSame
			cb.Same = b.Amount
		} else if b.Month >= 1 && b.Month <= 12 {
			cb.Monthly[b.Month-1] = b.Amount
		}
	}
	out := make([]CategoryBudget, 0, len(order))
	for _, id := range order {
		out = append(out, *byCat[id])
	}
	return out, nil
}

// SetCategoryBudget replaces a category's budget rows.
func (s *Service) SetCategoryBudget(ctx context.Context, walletID, categoryID int64, in Input) error {
	if in.Mode != ModeSame && in.Mode != ModeMonthly {
		return ErrInvalidMode
	}
	cat, err := s.q.GetCategory(ctx, categoryID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && cat.WalletID != walletID) {
		return ErrInvalidCategory
	}
	if err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if err := qtx.DeleteCategoryBudget(ctx, db.DeleteCategoryBudgetParams{WalletID: walletID, CategoryID: categoryID}); err != nil {
		return err
	}
	if in.Mode == ModeSame {
		if in.Same != 0 {
			if err := qtx.InsertBudget(ctx, db.InsertBudgetParams{WalletID: walletID, CategoryID: categoryID, Month: 0, Amount: in.Same}); err != nil {
				return err
			}
		}
	} else {
		for m := 1; m <= 12; m++ {
			if v := in.Monthly[m-1]; v != 0 {
				if err := qtx.InsertBudget(ctx, db.InsertBudgetParams{WalletID: walletID, CategoryID: categoryID, Month: int64(m), Amount: v}); err != nil {
					return err
				}
			}
		}
	}
	return tx.Commit()
}

// Report computes budget vs actual per category over [from, to]. When rollup is
// true, subcategory budgets and actuals roll up into their parent.
func (s *Service) Report(ctx context.Context, walletID int64, from, to string, rollup bool) (Report, error) {
	categories, err := s.q.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return Report{}, err
	}
	type catMeta struct {
		parent   *int64
		name     string
		isIncome bool
		noBudget bool
	}
	meta := make(map[int64]catMeta, len(categories))
	for _, c := range categories {
		var p *int64
		if c.ParentID.Valid {
			v := c.ParentID.Int64
			p = &v
		}
		meta[c.ID] = catMeta{parent: p, name: c.Name, isIncome: c.IsIncome != 0, noBudget: c.NoBudget != 0}
	}

	// Currencies for converting actuals to the base currency.
	currencies, err := s.q.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return Report{}, err
	}
	curByID := make(map[int64]db.Currency, len(currencies))
	var base *db.Currency
	for i := range currencies {
		curByID[currencies[i].ID] = currencies[i]
		if currencies[i].IsBase != 0 {
			base = &currencies[i]
		}
	}

	// Budgets per category and month.
	budgetRows, err := s.q.ListBudgetsForWallet(ctx, walletID)
	if err != nil {
		return Report{}, err
	}
	budgetByCat := map[int64]map[int64]int64{}
	for _, b := range budgetRows {
		if budgetByCat[b.CategoryID] == nil {
			budgetByCat[b.CategoryID] = map[int64]int64{}
		}
		budgetByCat[b.CategoryID][b.Month] = b.Amount
	}

	// Actuals in the period, converted to base.
	actualRows, err := s.q.CategoryActualsForBudget(ctx, db.CategoryActualsForBudgetParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return Report{}, err
	}
	actualByCat := map[int64]int64{}
	for _, r := range actualRows {
		if !r.CategoryID.Valid {
			continue
		}
		amt := r.Amount
		if base != nil {
			amt = convertToBase(r.Amount, curByID[r.CurrencyID], *base)
		}
		actualByCat[r.CategoryID.Int64] += amt
	}

	monthCounts, err := coveredMonths(from, to)
	if err != nil {
		return Report{}, err
	}

	// Aggregate per reporting key (the category, or its parent when rolling up),
	// skipping categories flagged no_budget.
	type agg struct {
		name     string
		isIncome bool
		budget   int64
		actual   int64
	}
	keyOf := func(id int64) int64 {
		if rollup {
			if p := meta[id].parent; p != nil {
				return *p
			}
		}
		return id
	}
	out := map[int64]*agg{}
	ensure := func(id int64) *agg {
		a, ok := out[id]
		if !ok {
			m := meta[id]
			a = &agg{name: m.name, isIncome: m.isIncome}
			out[id] = a
		}
		return a
	}
	for id, m := range meta {
		if m.noBudget {
			continue
		}
		b := budgetForPeriod(budgetByCat[id], monthCounts)
		act := actualByCat[id]
		if b == 0 && act == 0 {
			continue
		}
		key := keyOf(id)
		if meta[key].noBudget {
			continue
		}
		a := ensure(key)
		a.budget += b
		a.actual += act
	}

	rep := Report{From: from, To: to, Rollup: rollup, Rows: []ReportRow{}}
	for id, a := range out {
		rep.Rows = append(rep.Rows, ReportRow{CategoryID: id, Name: a.name, IsIncome: a.isIncome, Budget: a.budget, Actual: a.actual})
		rep.TotalBudget += a.budget
		rep.TotalActual += a.actual
	}
	sortRows(rep.Rows)
	if base != nil {
		rep.Currency = &CurrencyInfo{
			Code: base.IsoCode, Symbol: base.Symbol, SymbolPrefix: base.SymbolPrefix != 0,
			DecimalChar: base.DecimalChar, GroupChar: base.GroupChar, FracDigits: int(base.FracDigits),
		}
	}
	return rep, nil
}

// budgetForPeriod sums a category's monthly budget across the covered months.
// month 0 (same) applies to every covered month.
func budgetForPeriod(byMonth map[int64]int64, monthCounts [13]int) int64 {
	if byMonth == nil {
		return 0
	}
	if same, ok := byMonth[0]; ok {
		total := 0
		for m := 1; m <= 12; m++ {
			total += monthCounts[m]
		}
		return same * int64(total)
	}
	var sum int64
	for m := 1; m <= 12; m++ {
		sum += byMonth[int64(m)] * int64(monthCounts[m])
	}
	return sum
}

// coveredMonths returns, for each month number 1..12, how many times it appears
// in the inclusive [from, to] calendar range.
func coveredMonths(from, to string) ([13]int, error) {
	var counts [13]int
	f, err := time.Parse(dateLayout, from)
	if err != nil {
		return counts, err
	}
	t, err := time.Parse(dateLayout, to)
	if err != nil {
		return counts, err
	}
	cur := time.Date(f.Year(), f.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	for !cur.After(end) {
		counts[int(cur.Month())]++
		cur = cur.AddDate(0, 1, 0)
	}
	return counts, nil
}

func convertToBase(amount int64, cur, base db.Currency) int64 {
	if cur.ID == base.ID || cur.ID == 0 {
		return amount
	}
	scaled := float64(amount) * cur.Rate * math.Pow10(int(base.FracDigits)-int(cur.FracDigits))
	return int64(math.Round(scaled))
}

func sortRows(rows []ReportRow) {
	// Income rows first, then by name (stable, simple insertion sort — lists are
	// small).
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && less(rows[j], rows[j-1]); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

func less(a, b ReportRow) bool {
	if a.IsIncome != b.IsIncome {
		return a.IsIncome && !b.IsIncome
	}
	return a.Name < b.Name
}
