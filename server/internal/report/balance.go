package report

import (
	"context"
	"fmt"
	"time"
)

// BalanceSeries is one account's running balance over time, in its own currency.
type BalanceSeries struct {
	AccountID      int64         `json:"accountId"`
	Label          string        `json:"label"`
	MinimumBalance int64         `json:"minimumBalance"`
	Values         []int64       `json:"values"`
	Currency       *CurrencyInfo `json:"currency"`
	// Start is the balance before the range's first day.
	Start int64 `json:"start"`
	// Today is the balance at the end of the report's AsOf day.
	Today int64 `json:"today"`
	// Low is the lowest balance from the range's first day through AsOf (or the
	// range's last day, when that comes first), reached on LowDate. When that
	// span is empty LowDate is "" and Low is Start.
	Low     int64  `json:"low"`
	LowDate string `json:"lowDate"`
	// UnderMinimumOn is the first day of that span that ended below the
	// account's minimum balance: "" when none did, or when no minimum is set.
	UnderMinimumOn string `json:"underMinimumOn"`
}

// BalanceResult is the balance-over-time report.
type BalanceResult struct {
	Buckets []string        `json:"buckets"`
	Series  []BalanceSeries `json:"series"`
	// Total is the series summed per bucket, converted to the base currency;
	// StartTotal and TodayTotal are Start and Today summed the same way.
	Total      []int64 `json:"total"`
	StartTotal int64   `json:"startTotal"`
	TodayTotal int64   `json:"todayTotal"`
	// AsOf is the day the report counts as today.
	AsOf     string        `json:"asOf"`
	Currency *CurrencyInfo `json:"currency"`
}

// BalanceOptions are the balance report's optional parts.
type BalanceOptions struct {
	// AsOf is the caller's today (YYYY-MM-DD); empty means today in UTC.
	AsOf string
	// Scheduled adds the occurrences of the active schedules after AsOf, as the
	// cash-flow forecast does, so the buckets after today are a projection.
	Scheduled bool
}

// Balance computes each account's running balance at the end of every bucket:
// initial balance + all transactions up to that point, future-dated ones
// included. Values are in each account's own currency, so the final point
// equals the register running balance; Total converts them to the base
// currency. Only the date range and account selection apply (balances are not
// otherwise filtered). accountIDs empty means all accounts.
func (s *Service) Balance(ctx context.Context, walletID int64, from, to, bucket string, accountIDs []int64, opts BalanceOptions) (BalanceResult, error) {
	asOf := opts.AsOf
	if asOf == "" {
		asOf = time.Now().UTC().Format(dateLayout)
	}
	asOfDate, err := time.Parse(dateLayout, asOf)
	if err != nil {
		return BalanceResult{}, fmt.Errorf("report: invalid asOf %q: %w", asOf, err)
	}

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
		return BalanceResult{Buckets: []string{}, Series: []BalanceSeries{}, Total: []int64{}, AsOf: asOf}, nil
	}

	// Default range to the wallet's transaction span.
	if from == "" || to == "" {
		minD, maxD, err := s.dateRange(ctx, walletID)
		if err != nil {
			return BalanceResult{}, err
		}
		if from == "" {
			from = firstNonEmpty(minD, asOf)
		}
		if to == "" {
			to = firstNonEmpty(maxD, asOf)
		}
	}
	buckets, err := GenerateBuckets(from, to, bucket)
	if err != nil {
		return BalanceResult{}, err
	}

	idPH := placeholders(len(ids))
	// withIDs is the wallet id, the account ids, then rest: the argument order of
	// every query below.
	withIDs := func(rest ...any) []any {
		args := make([]any, 0, len(ids)+len(rest)+1)
		args = append(args, walletID)
		for _, id := range ids {
			args = append(args, id)
		}
		return append(args, rest...)
	}
	// sumBy runs a per-account SUM(amount) query and adds each sum into dst.
	sumBy := func(dst map[int64]int64, cond string, arg string) error {
		q := "SELECT account_id, CAST(SUM(amount) AS INTEGER) FROM transactions WHERE wallet_id = ? AND account_id IN (" + idPH + ") AND " + cond + " GROUP BY account_id"
		rows, err := s.db.QueryContext(ctx, q, withIDs(arg)...)
		if err != nil {
			return err
		}
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var id, sum int64
			if err := rows.Scan(&id, &sum); err != nil {
				return err
			}
			dst[id] += sum
		}
		return rows.Err()
	}

	// Opening balance per account = initial + everything before the range;
	// today's = initial + everything up to and including AsOf.
	opening := map[int64]int64{}
	today := map[int64]int64{}
	for id, m := range meta {
		opening[id] = m.initial
		today[id] = m.initial
	}
	if err := sumBy(opening, "date < ?", from); err != nil {
		return BalanceResult{}, err
	}
	if err := sumBy(today, "date <= ?", asOf); err != nil {
		return BalanceResult{}, err
	}

	// Per-account per-bucket delta within the range.
	delta := map[int64]map[string]int64{}
	for _, id := range ids {
		delta[id] = map[string]int64{}
	}
	{
		q := fmt.Sprintf(`SELECT t.account_id, %s AS bucket, CAST(SUM(t.amount) AS INTEGER) AS delta
FROM transactions t
WHERE t.wallet_id = ? AND t.account_id IN (%s) AND t.date >= ? AND t.date <= ?
GROUP BY t.account_id, bucket`, bucketExpr(bucket), idPH)
		rows, err := s.db.QueryContext(ctx, q, withIDs(from, to)...)
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

	// What the schedules will add after today, up to the range's end (at most a
	// year ahead, the forecast's own horizon).
	if opts.Scheduled && to > asOf {
		horizon, err := time.Parse(dateLayout, to)
		if err != nil {
			return BalanceResult{}, err
		}
		if limit := asOfDate.AddDate(0, 0, 366); horizon.After(limit) {
			horizon = limit
		}
		for _, id := range ids {
			daily := map[string]int64{}
			if err := s.projectSchedules(ctx, walletID, id, asOfDate, horizon, daily); err != nil {
				return BalanceResult{}, err
			}
			for d, v := range daily {
				if d < from {
					opening[id] += v
					continue
				}
				bk, err := BucketKey(d, bucket)
				if err != nil {
					return BalanceResult{}, err
				}
				delta[id][bk] += v
			}
		}
	}

	// The lowest point and the first dip under the minimum, day by day, from the
	// range's start through today.
	type dayDelta struct {
		date   string
		amount int64
	}
	days := map[int64][]dayDelta{}
	spanEnd := min(to, asOf)
	if from <= spanEnd {
		q := "SELECT account_id, date, CAST(SUM(amount) AS INTEGER) FROM transactions WHERE wallet_id = ? AND account_id IN (" + idPH + ") AND date >= ? AND date <= ? GROUP BY account_id, date ORDER BY account_id, date"
		rows, err := s.db.QueryContext(ctx, q, withIDs(from, spanEnd)...)
		if err != nil {
			return BalanceResult{}, err
		}
		for rows.Next() {
			var id int64
			var dd dayDelta
			if err := rows.Scan(&id, &dd.date, &dd.amount); err != nil {
				_ = rows.Close()
				return BalanceResult{}, err
			}
			days[id] = append(days[id], dd)
		}
		_ = rows.Close()
	}

	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return BalanceResult{}, err
	}
	toBase := func(v, currencyID int64) int64 {
		if base == nil {
			return v
		}
		return convertToBase(v, curByID[currencyID], *base)
	}

	out := BalanceResult{
		Buckets: buckets, Series: []BalanceSeries{}, Total: make([]int64, len(buckets)),
		AsOf: asOf, Currency: currencyInfo(base),
	}
	for _, id := range ids {
		m := meta[id]
		running := opening[id]
		vals := make([]int64, len(buckets))
		for i, b := range buckets {
			running += delta[id][b]
			vals[i] = running
			out.Total[i] += toBase(running, m.currency)
		}
		ser := BalanceSeries{
			AccountID: id, Label: m.name, MinimumBalance: m.minimum, Values: vals,
			Start: opening[id], Today: today[id], Low: opening[id],
		}
		if cur, ok := curByID[m.currency]; ok {
			ser.Currency = currencyInfo(&cur)
		}
		if from <= spanEnd {
			bal := opening[id]
			ser.LowDate = from
			under := func(d string) {
				if ser.UnderMinimumOn == "" && m.minimum != 0 && bal < m.minimum {
					ser.UnderMinimumOn = d
				}
			}
			under(from)
			for _, dd := range days[id] {
				bal += dd.amount
				if bal < ser.Low {
					ser.Low, ser.LowDate = bal, dd.date
				}
				under(dd.date)
			}
		}
		out.StartTotal += toBase(opening[id], m.currency)
		out.TodayTotal += toBase(today[id], m.currency)
		out.Series = append(out.Series, ser)
	}
	return out, nil
}
