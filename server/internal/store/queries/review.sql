-- name: ListImportedUncategorized :many
-- Bank-imported transactions (they carry an import ref) that still have no
-- category, so the review can prompt the user to complete them. Split
-- transactions carry their categories on the splits, so they are excluded.
SELECT *
FROM transactions
WHERE wallet_id = ? AND import_ref <> '' AND category_id IS NULL AND is_split = 0
ORDER BY date DESC, id DESC;

-- name: ListPayeeCategoryCounts :many
-- How many of the wallet's transactions since a day each payee has in each
-- category, split ones left out: the history Review's proposals (#706) read.
SELECT payee_id, category_id, COUNT(*) AS n
FROM transactions
WHERE wallet_id = ? AND date >= ? AND payee_id IS NOT NULL AND category_id IS NOT NULL AND is_split = 0
GROUP BY payee_id, category_id;

-- name: InsertDuplicateDismissal :exec
INSERT INTO duplicate_dismissals (wallet_id, txn_a_id, txn_b_id)
VALUES (?, ?, ?)
ON CONFLICT DO NOTHING;

-- name: ListDuplicateDismissals :many
SELECT txn_a_id, txn_b_id FROM duplicate_dismissals WHERE wallet_id = ?;

-- name: SetTransactionImportRef :exec
UPDATE transactions SET import_ref = ? WHERE id = ? AND wallet_id = ?;

-- name: ListDuplicateCandidates :many
-- Every transaction of the wallet, reduced to what the duplicate finder compares
-- and ordered for it: by account, amount, then date. The account/date index
-- holds all four columns, so this reads no table rows (#541).
SELECT n.id, n.account_id, n.amount, n.date
FROM accounts a
JOIN transactions n ON n.account_id = a.id
WHERE a.wallet_id = ?
ORDER BY n.account_id, n.amount, n.date, n.id;

-- name: ListTransactionsByIDs :many
SELECT * FROM transactions
WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));

-- name: ListUnconfirmedMailRows :many
-- Transactions read from a bank mail (#660) that the bank has still not
-- booked, dated on or before a day: a bank-sync merge would have replaced
-- their mail: ref with the bank's.
SELECT * FROM transactions
WHERE wallet_id = ? AND import_ref LIKE 'mail:%' AND date <= ?
ORDER BY date DESC, id DESC;

-- name: ListBankRowsNear :many
-- An account's rows booked by the bank (an import ref that is not a mail's)
-- dated between two days: what an unconfirmed mail row may be merged with.
SELECT * FROM transactions
WHERE account_id = sqlc.arg(account_id) AND import_ref <> '' AND import_ref NOT LIKE 'mail:%'
  AND date >= sqlc.arg(date_from) AND date <= sqlc.arg(date_to)
ORDER BY date, id;

-- name: ListReviewSnoozes :many
-- The wallet's review rows put off until a day after the given one (#775).
SELECT transaction_id, until FROM review_snoozes WHERE wallet_id = ? AND until > ?;

-- name: UpsertReviewSnooze :exec
INSERT INTO review_snoozes (transaction_id, wallet_id, until) VALUES (?, ?, ?)
ON CONFLICT (transaction_id) DO UPDATE SET until = excluded.until;

-- name: DeleteReviewSnooze :exec
DELETE FROM review_snoozes WHERE transaction_id = ? AND wallet_id = ?;

-- name: MoveMailMessagesToTransaction :exec
-- The mails that wrote a transaction now point at the one it was merged into.
UPDATE mail_messages SET transaction_id = sqlc.arg(to_id) WHERE transaction_id = sqlc.arg(from_id);

-- name: ListMailMessageIDsForTransaction :many
SELECT id FROM mail_messages WHERE transaction_id = ? ORDER BY id;

-- name: MoveMailMessagesByIDs :exec
-- Some of the mails that wrote a transaction now point at another one: a
-- merge moves them to the row it keeps, its undo moves them back (#786).
UPDATE mail_messages SET transaction_id = sqlc.arg(to_id)
WHERE transaction_id = sqlc.arg(from_id) AND id IN (sqlc.slice(ids));

-- name: MoveAttachmentsByIDs :exec
UPDATE attachments SET transaction_id = sqlc.arg(to_id)
WHERE transaction_id = sqlc.arg(from_id) AND id IN (sqlc.slice(ids));

-- name: RestoreTransaction :exec
-- Puts a transaction back exactly as it was, every column, inserting it when
-- it is gone (an undone merge, #786). An upsert, not INSERT OR REPLACE: a
-- replace deletes the row first, and its tags and attachments cascade away.
-- A payee, category, vehicle, template or user deleted since is left out.
INSERT INTO transactions (
    id, wallet_id, account_id, date, amount, payment_mode, status, info,
    payee_id, category_id, memo, is_split, created_at, updated_at,
    template_id, import_ref, vehicle_id, origin, created_by
)
VALUES (
    sqlc.arg(id), sqlc.arg(wallet_id), sqlc.arg(account_id), sqlc.arg(date), sqlc.arg(amount),
    sqlc.arg(payment_mode), sqlc.arg(status), sqlc.arg(info),
    (SELECT p.id FROM payees p WHERE p.id = sqlc.narg(payee_id)),
    (SELECT c.id FROM categories c WHERE c.id = sqlc.narg(category_id)),
    sqlc.arg(memo), sqlc.arg(is_split), sqlc.arg(created_at), sqlc.arg(updated_at),
    (SELECT tp.id FROM templates tp WHERE tp.id = sqlc.narg(template_id)),
    sqlc.arg(import_ref),
    (SELECT v.id FROM vehicles v WHERE v.id = sqlc.narg(vehicle_id)),
    sqlc.arg(origin),
    (SELECT u.id FROM users u WHERE u.id = sqlc.narg(created_by))
)
ON CONFLICT (id) DO UPDATE SET
    account_id = excluded.account_id, date = excluded.date, amount = excluded.amount,
    payment_mode = excluded.payment_mode, status = excluded.status, info = excluded.info,
    payee_id = excluded.payee_id, category_id = excluded.category_id, memo = excluded.memo,
    is_split = excluded.is_split, created_at = excluded.created_at, updated_at = excluded.updated_at,
    template_id = excluded.template_id, import_ref = excluded.import_ref,
    vehicle_id = excluded.vehicle_id, origin = excluded.origin, created_by = excluded.created_by;

-- name: InsertMergedImportRef :execrows
INSERT INTO merged_import_refs (account_id, import_ref, transaction_id) VALUES (?, ?, ?)
ON CONFLICT DO NOTHING;

-- name: DeleteMergedImportRef :exec
DELETE FROM merged_import_refs WHERE account_id = ? AND import_ref = ?;

-- name: ListMergedImportRefs :many
-- With the row each was merged into and its status, when it is still there.
SELECT m.import_ref, m.transaction_id, CAST(COALESCE(t.status, 0) AS INTEGER) AS status
FROM merged_import_refs m
LEFT JOIN transactions t ON t.id = m.transaction_id
WHERE m.account_id = ?;

-- name: GetReviewSnoozeUntil :one
SELECT until FROM review_snoozes WHERE transaction_id = ?;

-- name: GetReviewWaitingSince :one
SELECT since FROM review_waiting WHERE transaction_id = ?;

-- name: ListDuplicateDismissalsFor :many
SELECT txn_a_id, txn_b_id FROM duplicate_dismissals
WHERE txn_a_id = sqlc.arg(id) OR txn_b_id = sqlc.arg(id);

-- name: UpsertTransactionMerge :exec
INSERT INTO transaction_merges (wallet_id, undo) VALUES (?, ?)
ON CONFLICT (wallet_id) DO UPDATE SET
    undo = excluded.undo, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- name: GetTransactionMerge :one
SELECT * FROM transaction_merges WHERE wallet_id = ?;

-- name: DeleteTransactionMerge :exec
DELETE FROM transaction_merges WHERE wallet_id = ?;
