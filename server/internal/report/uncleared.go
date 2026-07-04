package report

import "context"

// UnclearedAccount summarises an account's not-yet-cleared (status None)
// transactions, in the account's own currency.
type UnclearedAccount struct {
	AccountID int64        `json:"accountId"`
	Name      string       `json:"accountName"`
	Count     int64        `json:"count"`
	Amount    int64        `json:"amount"`
	Currency  CurrencyInfo `json:"currency"`
}

// Uncleared returns, per account that has any, the count and net amount of
// transactions still in the None status (i.e. neither cleared nor reconciled) —
// the pool a reconciliation pass works through. Accounts with nothing uncleared
// are omitted. Amounts are in each account's own currency.
func (s *Service) Uncleared(ctx context.Context, walletID int64) ([]UnclearedAccount, error) {
	const q = `
SELECT a.id, a.name,
       c.iso_code, c.symbol, c.symbol_prefix, c.decimal_char, c.group_char, c.frac_digits,
       COUNT(t.id), COALESCE(SUM(t.amount), 0)
FROM accounts a
JOIN currencies c ON c.id = a.currency_id
JOIN transactions t ON t.account_id = a.id AND t.status = 0
WHERE a.wallet_id = ?
GROUP BY a.id
ORDER BY a.position, a.name`
	rows, err := s.db.QueryContext(ctx, q, walletID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []UnclearedAccount{}
	for rows.Next() {
		var u UnclearedAccount
		var prefix, frac int64
		if err := rows.Scan(
			&u.AccountID, &u.Name,
			&u.Currency.Code, &u.Currency.Symbol, &prefix, &u.Currency.DecimalChar,
			&u.Currency.GroupChar, &frac,
			&u.Count, &u.Amount,
		); err != nil {
			return nil, err
		}
		u.Currency.SymbolPrefix = prefix != 0
		u.Currency.FracDigits = int(frac)
		out = append(out, u)
	}
	return out, rows.Err()
}
