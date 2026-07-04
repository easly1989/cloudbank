package report

import (
	"context"
	"database/sql"
	"time"

	"github.com/easly1989/cloudbank/server/internal/schedule"
)

// CashflowResult is a forward balance projection for one account.
type CashflowResult struct {
	Dates    []string      `json:"dates"`
	Balances []int64       `json:"balances"`
	Minimum  int64         `json:"minimum"`
	Currency *CurrencyInfo `json:"currency"`
}

// scheduleRow is a schedule joined with its template, for projection.
type scheduleRow struct {
	nextDue     string
	unit        string
	everyN      int
	weekendMode int
	remaining   sql.NullInt64
	amount      int64
	isTransfer  bool
	accountID   sql.NullInt64
	toAccountID sql.NullInt64
}

// Cashflow projects an account's balance for each day from today through
// today+days. It starts from today's actual balance and walks forward applying
// (a) already-entered future-dated transactions and (b) simulated occurrences of
// the wallet's active schedules that affect this account — reusing the
// scheduler's recurrence calculator, so pre-registered future transactions (past
// the schedule's next-due) are not double-counted.
func (s *Service) Cashflow(ctx context.Context, walletID, accountID int64, days int) (CashflowResult, error) {
	if days < 1 {
		days = 90
	}
	if days > 365 {
		days = 365
	}

	// Account + its currency formatting.
	var initial, minimum int64
	var cur CurrencyInfo
	var prefix, frac int64
	err := s.db.QueryRowContext(ctx, `
SELECT a.initial_balance, a.minimum_balance,
       c.iso_code, c.symbol, c.symbol_prefix, c.decimal_char, c.group_char, c.frac_digits
FROM accounts a JOIN currencies c ON c.id = a.currency_id
WHERE a.id = ? AND a.wallet_id = ?`, accountID, walletID).
		Scan(&initial, &minimum, &cur.Code, &cur.Symbol, &prefix, &cur.DecimalChar, &cur.GroupChar, &frac)
	if err == sql.ErrNoRows {
		return CashflowResult{}, nil
	}
	if err != nil {
		return CashflowResult{}, err
	}
	cur.SymbolPrefix = prefix != 0
	cur.FracDigits = int(frac)

	today := time.Now().UTC().Truncate(24 * time.Hour)
	horizon := today.AddDate(0, 0, days)
	todayStr := schedule.FormatDate(today)
	horizonStr := schedule.FormatDate(horizon)

	// Starting balance = initial + everything dated on or before today.
	var pastSum int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ? AND date <= ?`,
		accountID, todayStr).Scan(&pastSum); err != nil {
		return CashflowResult{}, err
	}
	starting := initial + pastSum

	// Per-day deltas from already-entered future transactions.
	deltas := map[string]int64{}
	{
		rows, err := s.db.QueryContext(ctx,
			`SELECT date, CAST(SUM(amount) AS INTEGER) FROM transactions
			 WHERE account_id = ? AND date > ? AND date <= ? GROUP BY date`,
			accountID, todayStr, horizonStr)
		if err != nil {
			return CashflowResult{}, err
		}
		for rows.Next() {
			var d string
			var sum int64
			if err := rows.Scan(&d, &sum); err != nil {
				_ = rows.Close()
				return CashflowResult{}, err
			}
			deltas[d] += sum
		}
		_ = rows.Close()
	}

	// Add simulated schedule occurrences that hit this account.
	if err := s.projectSchedules(ctx, walletID, accountID, today, horizon, deltas); err != nil {
		return CashflowResult{}, err
	}

	// Build the running balance. Today's balance already includes everything on
	// or before today, so no delta is applied to the first point.
	dates := make([]string, days+1)
	balances := make([]int64, days+1)
	bal := starting
	for i := 0; i <= days; i++ {
		d := schedule.FormatDate(today.AddDate(0, 0, i))
		if i > 0 {
			bal += deltas[d]
		}
		dates[i] = d
		balances[i] = bal
	}
	return CashflowResult{Dates: dates, Balances: balances, Minimum: minimum, Currency: &cur}, nil
}

// projectSchedules enumerates each active schedule's occurrences in
// (today, horizon] and adds their signed effect on accountID to deltas.
func (s *Service) projectSchedules(ctx context.Context, walletID, accountID int64, today, horizon time.Time, deltas map[string]int64) error {
	rows, err := s.db.QueryContext(ctx, `
SELECT s.next_due, s.unit, s.every_n, s.weekend_mode, s.remaining,
       t.amount, t.is_transfer, t.account_id, t.to_account_id
FROM schedules s JOIN templates t ON t.id = s.template_id
WHERE s.wallet_id = ? AND (t.account_id = ? OR t.to_account_id = ?)`, walletID, accountID, accountID)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	var scheds []scheduleRow
	for rows.Next() {
		var r scheduleRow
		var isTransfer int64
		if err := rows.Scan(&r.nextDue, &r.unit, &r.everyN, &r.weekendMode, &r.remaining,
			&r.amount, &isTransfer, &r.accountID, &r.toAccountID); err != nil {
			return err
		}
		r.isTransfer = isTransfer != 0
		scheds = append(scheds, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, r := range scheds {
		// The signed amount this occurrence adds to accountID.
		var effect int64
		switch {
		case !r.isTransfer && r.accountID.Valid && r.accountID.Int64 == accountID:
			effect = r.amount // plain template amount (already signed)
		case r.isTransfer && r.accountID.Valid && r.accountID.Int64 == accountID:
			effect = -r.amount // outgoing leg
		case r.isTransfer && r.toAccountID.Valid && r.toAccountID.Int64 == accountID:
			effect = r.amount // incoming leg (same-currency approximation)
		default:
			continue
		}

		cur, err := schedule.ParseDate(r.nextDue)
		if err != nil {
			continue
		}
		remaining := -1
		if r.remaining.Valid {
			remaining = int(r.remaining.Int64)
		}
		// One occurrence is at least a day apart, so days+2 iterations bound it.
		for i := 0; i <= 367; i++ {
			if remaining == 0 {
				break
			}
			post, skip := schedule.AdjustWeekend(cur, r.weekendMode)
			if post.After(horizon) {
				break
			}
			if !skip && post.After(today) {
				deltas[schedule.FormatDate(post)] += effect
			}
			if remaining > 0 {
				remaining--
			}
			cur = schedule.AddInterval(cur, r.unit, r.everyN)
		}
	}
	return nil
}
