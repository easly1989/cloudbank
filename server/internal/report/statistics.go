// Package report builds the reporting foundation: a shared transaction filter
// (the register filter model) and SQL-aggregated reports. All grouping and
// summing happens in SQL; Go only converts already-aggregated per-currency
// subtotals to the base currency.
package report

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Grouping dimensions.
const (
	GroupCategory    = "category"
	GroupSubcategory = "subcategory"
	GroupPayee       = "payee"
	GroupTag         = "tag"
	GroupMonth       = "month"
	GroupYear        = "year"
)

// Filter mirrors the register filter model. Zero/empty fields are not applied.
type Filter struct {
	From       string
	To         string
	Status     *int
	PayeeID    *int64
	CategoryID *int64 // includes child categories
	Tags       []string
	AmountMin  *int64
	AmountMax  *int64
	Text       string
}

// Group is one aggregated bucket (amount in base currency, signed).
type Group struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Amount int64  `json:"amount"`
}

// CurrencyInfo carries base-currency formatting.
type CurrencyInfo struct {
	Code         string `json:"code"`
	Symbol       string `json:"symbol"`
	SymbolPrefix bool   `json:"symbolPrefix"`
	DecimalChar  string `json:"decimalChar"`
	GroupChar    string `json:"groupChar"`
	FracDigits   int    `json:"fracDigits"`
}

// Result is a statistics report.
type Result struct {
	Groups   []Group       `json:"groups"`
	Total    int64         `json:"total"`
	GroupBy  string        `json:"groupBy"`
	Currency *CurrencyInfo `json:"currency"`
}

// Service builds reports.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// ValidGroupBy reports whether g is a supported dimension.
func ValidGroupBy(g string) bool {
	switch g {
	case GroupCategory, GroupSubcategory, GroupPayee, GroupTag, GroupMonth, GroupYear:
		return true
	}
	return false
}

// categoryIDs returns the filter's category id plus its direct children.
func (s *Service) categoryIDs(ctx context.Context, walletID int64, id *int64) ([]int64, error) {
	if id == nil {
		return nil, nil
	}
	cats, err := s.q.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	ids := []int64{*id}
	for _, c := range cats {
		if c.ParentID.Valid && c.ParentID.Int64 == *id {
			ids = append(ids, c.ID)
		}
	}
	return ids, nil
}

// conds builds the shared transaction-level WHERE fragments (referencing the
// transactions alias t, accounts a and payees p). The category filter is added
// by the caller with the right column. catIDs is returned for that use.
func (s *Service) conds(ctx context.Context, walletID int64, f Filter) (parts []string, args []any, catIDs []int64, err error) {
	parts = append(parts, "t.wallet_id = ?")
	args = append(args, walletID)
	if f.From != "" {
		parts = append(parts, "t.date >= ?")
		args = append(args, f.From)
	}
	if f.To != "" {
		parts = append(parts, "t.date <= ?")
		args = append(args, f.To)
	}
	if f.Status != nil {
		parts = append(parts, "t.status = ?")
		args = append(args, *f.Status)
	}
	if f.PayeeID != nil {
		parts = append(parts, "t.payee_id = ?")
		args = append(args, *f.PayeeID)
	}
	if f.AmountMin != nil {
		parts = append(parts, "t.amount >= ?")
		args = append(args, *f.AmountMin)
	}
	if f.AmountMax != nil {
		parts = append(parts, "t.amount <= ?")
		args = append(args, *f.AmountMax)
	}
	if txt := strings.TrimSpace(f.Text); txt != "" {
		like := "%" + txt + "%"
		parts = append(parts, "(t.memo LIKE ? OR t.info LIKE ? OR COALESCE(p.name, '') LIKE ?)")
		args = append(args, like, like, like)
	}
	if len(f.Tags) > 0 {
		ph := placeholders(len(f.Tags))
		parts = append(parts, "t.id IN (SELECT tt.transaction_id FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name IN ("+ph+"))")
		for _, tag := range f.Tags {
			args = append(args, tag)
		}
	}
	catIDs, err = s.categoryIDs(ctx, walletID, f.CategoryID)
	return parts, args, catIDs, err
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// Statistics aggregates filtered transactions by the given dimension, in SQL,
// converting per-currency subtotals to the base currency.
func (s *Service) Statistics(ctx context.Context, walletID int64, f Filter, groupBy string) (Result, error) {
	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return Result{}, err
	}
	query, args, err := s.buildStatsQuery(ctx, walletID, f, groupBy)
	if err != nil {
		return Result{}, err
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = rows.Close() }()

	type acc struct {
		label  string
		amount int64
	}
	byKey := map[string]*acc{}
	order := []string{}
	for rows.Next() {
		var key, label string
		var currencyID, total int64
		if err := rows.Scan(&key, &label, &currencyID, &total); err != nil {
			return Result{}, err
		}
		if base != nil {
			total = convertToBase(total, curByID[currencyID], *base)
		}
		a, ok := byKey[key]
		if !ok {
			a = &acc{label: label}
			byKey[key] = a
			order = append(order, key)
		}
		a.amount += total
	}
	if err := rows.Err(); err != nil {
		return Result{}, err
	}

	out := Result{GroupBy: groupBy, Groups: []Group{}}
	for _, key := range order {
		a := byKey[key]
		out.Groups = append(out.Groups, Group{Key: key, Label: a.label, Amount: a.amount})
		out.Total += a.amount
	}
	sortGroups(out.Groups)
	if base != nil {
		out.Currency = &CurrencyInfo{
			Code: base.IsoCode, Symbol: base.Symbol, SymbolPrefix: base.SymbolPrefix != 0,
			DecimalChar: base.DecimalChar, GroupChar: base.GroupChar, FracDigits: int(base.FracDigits),
		}
	}
	return out, nil
}

func (s *Service) baseAndCurrencies(ctx context.Context, walletID int64) (*db.Currency, map[int64]db.Currency, error) {
	currencies, err := s.q.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return nil, nil, err
	}
	curByID := make(map[int64]db.Currency, len(currencies))
	var base *db.Currency
	for i := range currencies {
		curByID[currencies[i].ID] = currencies[i]
		if currencies[i].IsBase != 0 {
			base = &currencies[i]
		}
	}
	return base, curByID, nil
}

// buildStatsQuery builds the SQL for the dimension. Category and subcategory
// dimensions expand split lines; the others aggregate at the transaction level.
func (s *Service) buildStatsQuery(ctx context.Context, walletID int64, f Filter, groupBy string) (string, []any, error) {
	parts, args, catIDs, err := s.conds(ctx, walletID, f)
	if err != nil {
		return "", nil, err
	}
	where := strings.Join(parts, " AND ")
	catIn := ""
	if len(catIDs) > 0 {
		catIn = " AND %s IN (" + placeholders(len(catIDs)) + ")"
	}

	switch groupBy {
	case GroupCategory, GroupSubcategory:
		keyExpr, labelExpr := "c.id", "c.name"
		if groupBy == GroupCategory {
			keyExpr = "COALESCE(par.id, c.id)"
			labelExpr = "COALESCE(par.name, c.name)"
		}
		nonSplitCat := ""
		splitCat := ""
		nsArgs := append([]any{}, args...)
		spArgs := append([]any{}, args...)
		if catIn != "" {
			nonSplitCat = fmt.Sprintf(catIn, "c.id")
			splitCat = fmt.Sprintf(catIn, "c.id")
			for _, id := range catIDs {
				nsArgs = append(nsArgs, id)
			}
			for _, id := range catIDs {
				spArgs = append(spArgs, id)
			}
		}
		q := fmt.Sprintf(`
SELECT CAST(grp AS TEXT) AS key, label, currency_id, CAST(SUM(amount) AS INTEGER) AS total FROM (
  SELECT %[1]s AS grp, %[2]s AS label, a.currency_id AS currency_id, t.amount AS amount
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN payees p ON p.id = t.payee_id
  JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories par ON par.id = c.parent_id
  WHERE t.is_split = 0 AND t.category_id IS NOT NULL AND %[3]s%[4]s
  UNION ALL
  SELECT %[1]s AS grp, %[2]s AS label, a.currency_id AS currency_id, s.amount AS amount
  FROM splits s
  JOIN transactions t ON t.id = s.transaction_id
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN payees p ON p.id = t.payee_id
  JOIN categories c ON c.id = s.category_id
  LEFT JOIN categories par ON par.id = c.parent_id
  WHERE s.category_id IS NOT NULL AND %[3]s%[5]s
)
GROUP BY grp, currency_id`, keyExpr, labelExpr, where, nonSplitCat, splitCat)
		return q, append(nsArgs, spArgs...), nil

	case GroupPayee, GroupTag, GroupMonth, GroupYear:
		var keyExpr, labelExpr, extraJoin string
		switch groupBy {
		case GroupPayee:
			keyExpr, labelExpr = "COALESCE(t.payee_id, 0)", "COALESCE(p.name, '(none)')"
		case GroupTag:
			keyExpr, labelExpr = "tg.id", "tg.name"
			extraJoin = " JOIN transaction_tags tt ON tt.transaction_id = t.id JOIN tags tg ON tg.id = tt.tag_id"
		case GroupMonth:
			keyExpr, labelExpr = "substr(t.date, 1, 7)", "substr(t.date, 1, 7)"
		case GroupYear:
			keyExpr, labelExpr = "substr(t.date, 1, 4)", "substr(t.date, 1, 4)"
		}
		catCond := ""
		if catIn != "" {
			catCond = fmt.Sprintf(catIn, "t.category_id")
			for _, id := range catIDs {
				args = append(args, id)
			}
		}
		q := fmt.Sprintf(`
SELECT CAST(%[1]s AS TEXT) AS key, %[2]s AS label, a.currency_id AS currency_id, CAST(SUM(t.amount) AS INTEGER) AS total
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id%[5]s
WHERE %[3]s%[4]s
GROUP BY %[1]s, a.currency_id`, keyExpr, labelExpr, where, catCond, extraJoin)
		return q, args, nil
	}
	return "", nil, fmt.Errorf("report: invalid group %q", groupBy)
}

func convertToBase(amount int64, cur, base db.Currency) int64 {
	if cur.ID == base.ID || cur.ID == 0 {
		return amount
	}
	scaled := float64(amount) * cur.Rate * math.Pow10(int(base.FracDigits)-int(cur.FracDigits))
	return int64(math.Round(scaled))
}

func sortGroups(g []Group) {
	// Largest magnitude first (most significant slices on top).
	for i := 1; i < len(g); i++ {
		for j := i; j > 0 && abs(g[j].Amount) > abs(g[j-1].Amount); j-- {
			g[j], g[j-1] = g[j-1], g[j]
		}
	}
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// TxnRow is a transaction surfaced by drill-down.
type TxnRow struct {
	ID           int64  `json:"id"`
	AccountID    int64  `json:"accountId"`
	Date         string `json:"date"`
	Amount       int64  `json:"amount"`
	Memo         string `json:"memo"`
	PayeeName    string `json:"payeeName"`
	CategoryName string `json:"categoryName"`
}

// Drilldown returns the filtered transactions belonging to one group bucket.
func (s *Service) Drilldown(ctx context.Context, walletID int64, f Filter, groupBy, groupKey string) ([]TxnRow, error) {
	parts, args, _, err := s.conds(ctx, walletID, f)
	if err != nil {
		return nil, err
	}
	cond, condArgs, err := s.groupCond(ctx, walletID, groupBy, groupKey)
	if err != nil {
		return nil, err
	}
	parts = append(parts, cond)
	args = append(args, condArgs...)
	where := strings.Join(parts, " AND ")

	q := `
SELECT DISTINCT t.id, t.account_id, t.date, t.amount, t.memo,
       COALESCE(p.name, '') AS payee_name, COALESCE(c.name, '') AS category_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN categories c ON c.id = t.category_id
WHERE ` + where + `
ORDER BY t.date DESC, t.id DESC
LIMIT 500`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []TxnRow{}
	for rows.Next() {
		var r TxnRow
		if err := rows.Scan(&r.ID, &r.AccountID, &r.Date, &r.Amount, &r.Memo, &r.PayeeName, &r.CategoryName); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// groupCond builds the transaction-level condition selecting one group bucket.
func (s *Service) groupCond(ctx context.Context, walletID int64, groupBy, key string) (string, []any, error) {
	switch groupBy {
	case GroupPayee:
		if key == "0" || key == "" {
			return "t.payee_id IS NULL", nil, nil
		}
		return "t.payee_id = ?", []any{key}, nil
	case GroupMonth:
		return "substr(t.date, 1, 7) = ?", []any{key}, nil
	case GroupYear:
		return "substr(t.date, 1, 4) = ?", []any{key}, nil
	case GroupTag:
		return "t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = ?)", []any{key}, nil
	case GroupCategory, GroupSubcategory:
		var id int64
		if _, err := fmt.Sscan(key, &id); err != nil {
			return "1 = 0", nil, nil
		}
		ids := []int64{id}
		if groupBy == GroupCategory {
			cats, err := s.q.ListCategoriesForWallet(ctx, walletID)
			if err != nil {
				return "", nil, err
			}
			for _, c := range cats {
				if c.ParentID.Valid && c.ParentID.Int64 == id {
					ids = append(ids, c.ID)
				}
			}
		}
		ph := placeholders(len(ids))
		args := make([]any, 0, len(ids)*2)
		for _, v := range ids {
			args = append(args, v)
		}
		for _, v := range ids {
			args = append(args, v)
		}
		cond := "(t.category_id IN (" + ph + ") OR t.id IN (SELECT transaction_id FROM splits WHERE category_id IN (" + ph + ")))"
		return cond, args, nil
	}
	return "1 = 0", nil, nil
}
