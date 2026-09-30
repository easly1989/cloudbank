-- name: InsertCurrency :one
INSERT INTO currencies (
    wallet_id, iso_code, name, symbol, symbol_prefix,
    decimal_char, group_char, frac_digits, is_base, rate
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetCurrency :one
SELECT * FROM currencies WHERE id = ? LIMIT 1;

-- name: ListCurrenciesForWallet :many
SELECT * FROM currencies WHERE wallet_id = ? ORDER BY is_base DESC, iso_code;

-- name: GetBaseCurrency :one
SELECT * FROM currencies WHERE wallet_id = ? AND is_base = 1 LIMIT 1;

-- name: CountWalletCurrencies :one
SELECT COUNT(*) FROM currencies WHERE wallet_id = ?;

-- name: ClearWalletBase :exec
UPDATE currencies SET is_base = 0 WHERE wallet_id = ?;

-- name: SetCurrencyBase :exec
UPDATE currencies SET is_base = 1, rate = 1 WHERE id = ?;

-- name: UpdateWalletBaseCurrency :exec
UPDATE wallets SET base_currency_id = ? WHERE id = ?;

-- name: UpdateCurrencyRate :exec
UPDATE currencies
SET rate = ?, rate_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: UpdateCurrencyFormat :exec
UPDATE currencies
SET symbol = ?, symbol_prefix = ?, decimal_char = ?, group_char = ?, frac_digits = ?
WHERE id = ?;

-- name: ScaleWalletRates :exec
-- Rates are what one unit is worth in the base; a new base divides them all by
-- its own old rate, so they read against it (#558).
UPDATE currencies SET rate = rate / sqlc.arg(divisor) WHERE wallet_id = sqlc.arg(wallet_id);

-- name: CountCurrencyAccounts :one
SELECT COUNT(*) FROM accounts WHERE currency_id = ?;

-- name: ListLatestRatesForWallet :many
-- Each currency's latest recorded rate: where it came from, and its date.
SELECT er.currency_id, er.date, er.source
FROM exchange_rates er
JOIN currencies c ON c.id = er.currency_id
WHERE c.wallet_id = ?
  AND er.date = (SELECT MAX(e2.date) FROM exchange_rates e2 WHERE e2.currency_id = er.currency_id);

-- name: DeleteCurrency :exec
DELETE FROM currencies WHERE id = ?;

-- name: UpsertExchangeRate :exec
INSERT INTO exchange_rates (currency_id, date, rate, source)
VALUES (?, ?, ?, ?)
ON CONFLICT (currency_id, date) DO UPDATE SET rate = excluded.rate, source = excluded.source;

-- name: ListExchangeRates :many
SELECT * FROM exchange_rates WHERE currency_id = ? ORDER BY date DESC;
