-- name: GetAISettings :one
SELECT enabled, base_url, model, api_key, suggest_on, entry_on, mail_on, reports_on, monthly_limit, motion,
       weekly_on, yearly_on
FROM ai_settings WHERE user_id = ?;

-- name: UpsertAISettings :exec
INSERT INTO ai_settings (
    user_id, enabled, base_url, model, api_key,
    suggest_on, entry_on, mail_on, reports_on, monthly_limit, motion, weekly_on, yearly_on, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (user_id) DO UPDATE SET
    enabled = excluded.enabled, base_url = excluded.base_url,
    model = excluded.model, api_key = excluded.api_key,
    suggest_on = excluded.suggest_on, entry_on = excluded.entry_on,
    mail_on = excluded.mail_on, reports_on = excluded.reports_on,
    monthly_limit = excluded.monthly_limit, motion = excluded.motion,
    weekly_on = excluded.weekly_on, yearly_on = excluded.yearly_on,
    updated_at = excluded.updated_at;

-- name: ListAIWalletsOff :many
SELECT wallet_id FROM ai_wallets_off WHERE user_id = ? ORDER BY wallet_id;

-- name: ClearAIWalletsOff :exec
DELETE FROM ai_wallets_off WHERE user_id = ?;

-- name: AddAIWalletOff :exec
INSERT OR IGNORE INTO ai_wallets_off (user_id, wallet_id) VALUES (?, ?);

-- name: AIWalletOff :one
SELECT COUNT(*) FROM ai_wallets_off WHERE user_id = ? AND wallet_id = ?;

-- name: CountAISendsSince :one
SELECT COUNT(*) FROM ai_sends WHERE user_id = ? AND created_at >= ?;

-- name: InsertAISend :one
INSERT INTO ai_sends (user_id, wallet_id, feature, model, sent) VALUES (?, ?, ?, ?, ?)
RETURNING id;

-- name: PurgeAISends :exec
DELETE FROM ai_sends WHERE user_id = ? AND created_at < ?;

-- name: ListAISends :many
SELECT s.id, s.wallet_id, COALESCE(w.title, '') AS wallet_name, s.feature, s.model, s.created_at
FROM ai_sends s
LEFT JOIN wallets w ON w.id = s.wallet_id
WHERE s.user_id = ?
ORDER BY s.created_at DESC, s.id DESC
LIMIT ?;

-- name: GetAISend :one
SELECT s.id, s.wallet_id, COALESCE(w.title, '') AS wallet_name, s.feature, s.model, s.sent, s.created_at
FROM ai_sends s
LEFT JOIN wallets w ON w.id = s.wallet_id
WHERE s.user_id = ? AND s.id = ?;

-- name: InsertAIReport :one
INSERT INTO ai_reports (user_id, wallet_id, kind, period, body, basis, model)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING id, kind, period, body, basis, model, feedback, created_at;

-- name: ListAIReports :many
SELECT id, kind, period, body, basis, model, feedback, created_at
FROM ai_reports
WHERE user_id = ? AND wallet_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 60;

-- name: SetAIReportFeedback :execrows
UPDATE ai_reports SET feedback = ? WHERE id = ? AND user_id = ? AND wallet_id = ?;

-- name: LargestExpenses :many
-- The month's largest expenses for a report (#696): date, amount in the
-- account's currency, payee. Transfers and categories kept out of the reports
-- are left out, as on the overview's chart; the caller converts and keeps the
-- top three.
SELECT t.date, t.amount, a.currency_id AS currency_id, COALESCE(p.name, '') AS payee
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.amount < 0
  AND t.payment_mode <> 5
  AND (t.category_id IS NULL OR t.category_id NOT IN (SELECT cc.id FROM categories cc LEFT JOIN categories pp ON pp.id = cc.parent_id WHERE cc.wallet_id = sqlc.arg(wallet_id) AND (cc.no_report = 1 OR pp.no_report = 1)))
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
ORDER BY t.amount ASC
LIMIT 20;

-- name: ListAIReportUsers :many
-- The people whose AI writes reports (#697), with which ones come by themselves.
SELECT s.user_id, s.weekly_on, s.yearly_on, u.locale
FROM ai_settings s
JOIN users u ON u.id = s.user_id
WHERE s.enabled = 1 AND s.reports_on = 1
ORDER BY s.user_id;

-- name: AIReportDone :one
-- Whether a period of a wallet already has a report, or the scheduler already
-- did what it could about it.
SELECT CAST(EXISTS (
    SELECT 1 FROM ai_reports r
    WHERE r.user_id = sqlc.arg(user_id) AND r.wallet_id = sqlc.arg(wallet_id)
      AND r.kind = sqlc.arg(kind) AND r.period = sqlc.arg(period)
) OR EXISTS (
    SELECT 1 FROM ai_report_runs x
    WHERE x.user_id = sqlc.arg(user_id) AND x.wallet_id = sqlc.arg(wallet_id)
      AND x.kind = sqlc.arg(kind) AND x.period = sqlc.arg(period)
) AS INTEGER) AS done;

-- name: InsertAIReportRun :exec
INSERT OR IGNORE INTO ai_report_runs (user_id, wallet_id, kind, period, outcome) VALUES (?, ?, ?, ?, ?);
