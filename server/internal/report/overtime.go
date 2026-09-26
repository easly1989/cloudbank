package report

import (
	"context"
	"fmt"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Trend breakdown dimensions.
const (
	BreakdownNone     = "none"
	BreakdownAccount  = "account"
	BreakdownPayee    = "payee"
	BreakdownCategory = "category"
	// BreakdownFlow splits each bucket into what came in (series "in") and what
	// went out (series "out"), judged per transaction by the sign of its amount.
	BreakdownFlow = "flow"
)

// ValidBreakdown reports whether b is a supported trend breakdown.
func ValidBreakdown(b string) bool {
	switch b {
	case BreakdownNone, BreakdownAccount, BreakdownPayee, BreakdownCategory, BreakdownFlow:
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
	case BreakdownFlow:
		keyExpr = "CASE WHEN t.amount < 0 THEN 'out' ELSE 'in' END"
		labelExpr = keyExpr
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

	if breakdown == BreakdownFlow {
		// Both series, always in this order, so a period with nothing coming in
		// still has an "in" row of zeros.
		seriesOrder = []string{"in", "out"}
		labels["in"], labels["out"] = "in", "out"
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
