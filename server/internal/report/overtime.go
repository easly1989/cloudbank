package report

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Trend breakdown dimensions.
const (
	BreakdownNone     = "none"
	BreakdownAccount  = "account"
	BreakdownPayee    = "payee"
	BreakdownCategory = "category"
)

// ValidBreakdown reports whether b is a supported trend breakdown.
func ValidBreakdown(b string) bool {
	switch b {
	case BreakdownNone, BreakdownAccount, BreakdownPayee, BreakdownCategory:
		return true
	}
	return false
}

// Series is a named line aligned to the report's Buckets.
type Series struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Values []int64 `json:"values"`
}

// TrendResult is bucketed sums over time, optionally split into series.
type TrendResult struct {
	Buckets  []string      `json:"buckets"`
	Series   []Series      `json:"series"`
	Currency *CurrencyInfo `json:"currency"`
}

// Trend buckets filtered transactions over time (base currency). It does not
// compute the cumulative running total — the caller does that if requested.
func (s *Service) Trend(ctx context.Context, walletID int64, f Filter, bucket, breakdown string) (TrendResult, error) {
	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return TrendResult{}, err
	}
	parts, args, catIDs, err := s.conds(ctx, walletID, f)
	if err != nil {
		return TrendResult{}, err
	}
	if len(catIDs) > 0 {
		parts = append(parts, "t.category_id IN ("+placeholders(len(catIDs))+")")
		for _, id := range catIDs {
			args = append(args, id)
		}
	}

	var keyExpr, labelExpr, extra string
	switch breakdown {
	case BreakdownAccount:
		keyExpr, labelExpr = "t.account_id", "a.name"
	case BreakdownPayee:
		keyExpr, labelExpr = "COALESCE(t.payee_id, 0)", "COALESCE(p.name, '(none)')"
	case BreakdownCategory:
		keyExpr = "COALESCE(par.id, c.id)"
		labelExpr = "COALESCE(par.name, c.name)"
		extra = " JOIN categories c ON c.id = t.category_id LEFT JOIN categories par ON par.id = c.parent_id"
		parts = append(parts, "t.category_id IS NOT NULL")
	default:
		keyExpr, labelExpr = "'all'", "'Total'"
	}

	query := fmt.Sprintf(`
SELECT %[1]s AS bucket, CAST(%[2]s AS TEXT) AS skey, %[3]s AS slabel, a.currency_id AS currency_id,
       CAST(SUM(t.amount) AS INTEGER) AS total
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id%[4]s
WHERE %[5]s
GROUP BY bucket, skey, a.currency_id`, bucketExpr(bucket), keyExpr, labelExpr, extra, strings.Join(parts, " AND "))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return TrendResult{}, err
	}
	defer func() { _ = rows.Close() }()

	// cell[seriesKey][bucket] = amount; remember series labels and order.
	cell := map[string]map[string]int64{}
	labels := map[string]string{}
	seriesOrder := []string{}
	for rows.Next() {
		var bucketKey, skey, slabel string
		var currencyID, total int64
		if err := rows.Scan(&bucketKey, &skey, &slabel, &currencyID, &total); err != nil {
			return TrendResult{}, err
		}
		if base != nil {
			total = convertToBase(total, curByID[currencyID], *base)
		}
		if cell[skey] == nil {
			cell[skey] = map[string]int64{}
			labels[skey] = slabel
			seriesOrder = append(seriesOrder, skey)
		}
		cell[skey][bucketKey] += total
	}
	if err := rows.Err(); err != nil {
		return TrendResult{}, err
	}

	buckets, err := s.bucketAxis(ctx, walletID, f, bucket)
	if err != nil {
		return TrendResult{}, err
	}
	out := TrendResult{Buckets: buckets, Series: []Series{}, Currency: currencyInfo(base)}
	for _, skey := range seriesOrder {
		vals := make([]int64, len(buckets))
		for i, b := range buckets {
			vals[i] = cell[skey][b]
		}
		out.Series = append(out.Series, Series{Key: skey, Label: labels[skey], Values: vals})
	}
	return out, nil
}

// bucketAxis returns the continuous ordered bucket keys for the report range.
// The range is the filter's [From, To] when set, else the wallet's min/max
// transaction dates.
func (s *Service) bucketAxis(ctx context.Context, walletID int64, f Filter, bucket string) ([]string, error) {
	from, to := f.From, f.To
	if from == "" || to == "" {
		minD, maxD, err := s.dateRange(ctx, walletID)
		if err != nil {
			return nil, err
		}
		if minD == "" {
			return []string{}, nil
		}
		if from == "" {
			from = minD
		}
		if to == "" {
			to = maxD
		}
	}
	return GenerateBuckets(from, to, bucket)
}

func (s *Service) dateRange(ctx context.Context, walletID int64) (string, string, error) {
	var minD, maxD *string
	row := s.db.QueryRowContext(ctx, "SELECT MIN(date), MAX(date) FROM transactions WHERE wallet_id = ?", walletID)
	if err := row.Scan(&minD, &maxD); err != nil {
		return "", "", err
	}
	if minD == nil || maxD == nil {
		return "", "", nil
	}
	return *minD, *maxD, nil
}

// BalanceSeries is one account's running balance over time (its own currency).
type BalanceSeries struct {
	AccountID      int64   `json:"accountId"`
	Label          string  `json:"label"`
	MinimumBalance int64   `json:"minimumBalance"`
	Values         []int64 `json:"values"`
}

// BalanceResult is the balance-over-time report.
type BalanceResult struct {
	Buckets  []string        `json:"buckets"`
	Series   []BalanceSeries `json:"series"`
	Currency *CurrencyInfo   `json:"currency"`
}

// Balance computes each account's running balance at the end of every bucket:
// initial balance + all transactions up to that point. Values are in each
// account's own currency, so the final point equals the register running
// balance. Only the date range and account selection apply (balances are not
// otherwise filtered). accountIDs empty means all accounts.
func (s *Service) Balance(ctx context.Context, walletID int64, from, to, bucket string, accountIDs []int64) (BalanceResult, error) {
	accounts, err := s.q.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return BalanceResult{}, err
	}
	want := map[int64]bool{}
	for _, id := range accountIDs {
		want[id] = true
	}
	type acctMeta struct {
		name     string
		initial  int64
		minimum  int64
		currency int64
	}
	meta := map[int64]acctMeta{}
	ids := []int64{}
	for _, a := range accounts {
		if len(accountIDs) > 0 && !want[a.ID] {
			continue
		}
		meta[a.ID] = acctMeta{name: a.Name, initial: a.InitialBalance, minimum: a.MinimumBalance, currency: a.CurrencyID}
		ids = append(ids, a.ID)
	}
	if len(ids) == 0 {
		return BalanceResult{Buckets: []string{}, Series: []BalanceSeries{}}, nil
	}

	// Default range to the wallet's transaction span.
	if from == "" || to == "" {
		minD, maxD, err := s.dateRange(ctx, walletID)
		if err != nil {
			return BalanceResult{}, err
		}
		if from == "" {
			from = firstNonEmpty(minD, time.Now().UTC().Format(dateLayout))
		}
		if to == "" {
			to = firstNonEmpty(maxD, time.Now().UTC().Format(dateLayout))
		}
	}
	buckets, err := GenerateBuckets(from, to, bucket)
	if err != nil {
		return BalanceResult{}, err
	}

	idPH := placeholders(len(ids))
	idArgs := func() []any {
		a := make([]any, 0, len(ids)+2)
		return a
	}

	// Opening balance per account = initial + sum of amounts before the range.
	opening := map[int64]int64{}
	for id, m := range meta {
		opening[id] = m.initial
	}
	{
		args := append(idArgs(), walletID)
		for _, id := range ids {
			args = append(args, id)
		}
		args = append(args, from)
		q := "SELECT account_id, CAST(SUM(amount) AS INTEGER) FROM transactions WHERE wallet_id = ? AND account_id IN (" + idPH + ") AND date < ? GROUP BY account_id"
		rows, err := s.db.QueryContext(ctx, q, args...)
		if err != nil {
			return BalanceResult{}, err
		}
		for rows.Next() {
			var id, sum int64
			if err := rows.Scan(&id, &sum); err != nil {
				_ = rows.Close()
				return BalanceResult{}, err
			}
			opening[id] += sum
		}
		_ = rows.Close()
	}

	// Per-account per-bucket delta within the range.
	delta := map[int64]map[string]int64{}
	for _, id := range ids {
		delta[id] = map[string]int64{}
	}
	{
		args := append(idArgs(), walletID)
		for _, id := range ids {
			args = append(args, id)
		}
		args = append(args, from, to)
		q := fmt.Sprintf(`SELECT t.account_id, %s AS bucket, CAST(SUM(t.amount) AS INTEGER) AS delta
FROM transactions t
WHERE t.wallet_id = ? AND t.account_id IN (%s) AND t.date >= ? AND t.date <= ?
GROUP BY t.account_id, bucket`, bucketExpr(bucket), idPH)
		rows, err := s.db.QueryContext(ctx, q, args...)
		if err != nil {
			return BalanceResult{}, err
		}
		for rows.Next() {
			var id, d int64
			var bk string
			if err := rows.Scan(&id, &bk, &d); err != nil {
				_ = rows.Close()
				return BalanceResult{}, err
			}
			delta[id][bk] += d
		}
		_ = rows.Close()
	}

	base, _, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return BalanceResult{}, err
	}
	out := BalanceResult{Buckets: buckets, Series: []BalanceSeries{}, Currency: currencyInfo(base)}
	for _, id := range ids {
		m := meta[id]
		running := opening[id]
		vals := make([]int64, len(buckets))
		for i, b := range buckets {
			running += delta[id][b]
			vals[i] = running
		}
		out.Series = append(out.Series, BalanceSeries{AccountID: id, Label: m.name, MinimumBalance: m.minimum, Values: vals})
	}
	return out, nil
}

func currencyInfo(base *db.Currency) *CurrencyInfo {
	if base == nil {
		return nil
	}
	return &CurrencyInfo{
		Code: base.IsoCode, Symbol: base.Symbol, SymbolPrefix: base.SymbolPrefix != 0,
		DecimalChar: base.DecimalChar, GroupChar: base.GroupChar, FracDigits: int(base.FracDigits),
	}
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
