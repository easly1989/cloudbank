-- name: InsertMailbox :one
INSERT INTO mailboxes (wallet_id, created_by, provider, address, secret)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: InsertIMAPMailbox :one
INSERT INTO mailboxes (wallet_id, created_by, provider, address, secret, imap_host, imap_port, imap_security, imap_username)
VALUES (?, ?, 'imap', ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: SetMailboxIMAP :exec
-- New settings for an IMAP mailbox, after a login with them worked.
UPDATE mailboxes
SET secret = ?, imap_host = ?, imap_port = ?, imap_security = ?, imap_username = ?
WHERE id = ?;

-- name: GetMailbox :one
SELECT * FROM mailboxes WHERE id = ? AND wallet_id = ? LIMIT 1;

-- name: FindMailboxByAddress :one
SELECT * FROM mailboxes WHERE wallet_id = ? AND provider = ? AND address = ? LIMIT 1;

-- name: ListMailboxesForWallet :many
SELECT * FROM mailboxes WHERE wallet_id = ? ORDER BY created_at, id;

-- name: ListSourcesToWatch :many
-- Every source the listener should keep open, with its mailbox: not paused,
-- and not waiting for a new sign-in, across all wallets.
SELECT sqlc.embed(mail_sources), sqlc.embed(mailboxes)
FROM mail_sources
JOIN mailboxes ON mailboxes.id = mail_sources.mailbox_id
WHERE mailboxes.paused = 0 AND mailboxes.status != 'reauth'
ORDER BY mail_sources.id;

-- name: SetMailboxAlerted :execrows
-- Changes the flag only when it differs, so the caller learns from the row
-- count whether this is the moment it changed.
UPDATE mailboxes SET alerted = ? WHERE id = ? AND alerted != ?;

-- name: DeleteMailbox :execrows
DELETE FROM mailboxes WHERE id = ? AND wallet_id = ?;

-- name: SetMailboxSecret :exec
UPDATE mailboxes SET secret = ? WHERE id = ?;

-- name: SetMailboxPaused :exec
UPDATE mailboxes SET paused = ? WHERE id = ?;

-- name: RecordMailboxCheck :exec
UPDATE mailboxes
SET last_check_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = ?, status_detail = ?
WHERE id = ?;

-- name: TouchMailboxLastMail :exec
UPDATE mailboxes SET last_mail_at = ? WHERE id = ?;

-- name: InsertMailMessage :many
-- Returns the new row's id, or nothing when the mail was already there.
INSERT INTO mail_messages (mailbox_id, source_id, folder, uid, message_id, sender, subject, received_at, body, authenticated)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (mailbox_id, message_id) DO NOTHING
RETURNING id;

-- name: GetMailMessageByMessageID :one
SELECT * FROM mail_messages WHERE mailbox_id = ? AND message_id = ? LIMIT 1;

-- name: MoveMailMessage :exec
-- A mail stored unclaimed from one folder, claimed by a source of another.
UPDATE mail_messages SET source_id = ?, folder = ?, uid = ? WHERE id = ?;

-- name: ListMailMessages :many
SELECT m.id, m.mailbox_id, m.uid, m.message_id, m.sender, m.subject, m.received_at, m.outcome,
       m.detail, m.authenticated, m.pattern_id, m.transaction_id, t.account_id,
       t.amount AS transaction_amount, t.memo AS transaction_memo, p.name AS transaction_payee,
       m.created_at, m.by_ai, m.source_id, s.name AS source_name
FROM mail_messages m
LEFT JOIN transactions t ON t.id = m.transaction_id
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN mail_sources s ON s.id = m.source_id
WHERE m.mailbox_id = ? ORDER BY m.id DESC LIMIT ?;

-- name: GetMailMessage :one
SELECT * FROM mail_messages WHERE id = ? AND mailbox_id = ? LIMIT 1;

-- name: GetMailMessageView :one
-- One mail with the account of the transaction it made, for the history.
SELECT m.id, m.sender, m.subject, m.received_at, m.body, m.outcome, m.detail, m.authenticated,
       m.pattern_id, m.transaction_id, t.account_id,
       t.amount AS transaction_amount, t.memo AS transaction_memo, p.name AS transaction_payee,
       m.by_ai, m.source_id, s.name AS source_name
FROM mail_messages m
LEFT JOIN transactions t ON t.id = m.transaction_id
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN mail_sources s ON s.id = m.source_id
WHERE m.id = ? AND m.mailbox_id = ? LIMIT 1;

-- name: ListMailMessagesToRetry :many
-- The mails of one folder that made no transaction, oldest first, for a
-- pattern saved or corrected after them: none read them, or one did and
-- failed.
SELECT * FROM mail_messages
WHERE mailbox_id = ? AND folder = ? AND outcome IN ('unrecognized', 'unverified', 'failed')
ORDER BY id;

-- name: ListMailMessagesFrom :many
-- The latest mails of one sender in one folder, for trying a pattern before
-- saving it.
SELECT * FROM mail_messages
WHERE mailbox_id = ? AND folder = ? AND sender = ?
ORDER BY id DESC LIMIT ?;

-- name: SetMailMessageOutcome :exec
UPDATE mail_messages SET outcome = ?, detail = ?, pattern_id = ?, transaction_id = ?, by_ai = ?, source_id = ?
WHERE id = ?;

-- name: ListMailPatterns :many
SELECT * FROM mail_patterns WHERE source_id = ? ORDER BY position, id;

-- name: GetMailPattern :one
SELECT * FROM mail_patterns WHERE id = ? AND source_id = ? LIMIT 1;

-- name: InsertMailPattern :one
INSERT INTO mail_patterns (
    mailbox_id, source_id, position, name, sender, subject_mode, subject, body, account_id, cards,
    direction, in_words, payment_mode, apply_rules, date_format, require_auth, editor
)
VALUES (
    sqlc.arg(mailbox_id), sqlc.arg(source_id),
    (SELECT COALESCE(MAX(p.position) + 1, 0) FROM mail_patterns p WHERE p.source_id = sqlc.arg(source_id)),
    sqlc.arg(name), sqlc.arg(sender), sqlc.arg(subject_mode), sqlc.arg(subject), sqlc.arg(body),
    sqlc.arg(account_id), sqlc.arg(cards), sqlc.arg(direction), sqlc.arg(in_words),
    sqlc.arg(payment_mode), sqlc.arg(apply_rules), sqlc.arg(date_format), sqlc.arg(require_auth),
    sqlc.arg(editor)
)
RETURNING *;

-- name: UpdateMailPattern :execrows
UPDATE mail_patterns
SET name = ?, sender = ?, subject_mode = ?, subject = ?, body = ?, account_id = ?, cards = ?,
    direction = ?, in_words = ?, payment_mode = ?, apply_rules = ?, date_format = ?,
    require_auth = ?, editor = ?
WHERE id = ? AND source_id = ?;

-- name: DeleteMailPattern :execrows
DELETE FROM mail_patterns WHERE id = ? AND source_id = ?;

-- name: SetMailPatternPosition :exec
UPDATE mail_patterns SET position = ? WHERE id = ? AND source_id = ?;

-- name: ListMailSources :many
SELECT * FROM mail_sources WHERE mailbox_id = ? ORDER BY position, id;

-- name: GetMailSource :one
SELECT * FROM mail_sources WHERE id = ? AND mailbox_id = ? LIMIT 1;

-- name: InsertMailSource :one
-- Added at the end of the mailbox's list, its cursor at the folder's end.
INSERT INTO mail_sources (mailbox_id, position, name, folder, uid_validity, last_uid)
VALUES (
    sqlc.arg(mailbox_id),
    (SELECT COALESCE(MAX(s.position) + 1, 0) FROM mail_sources s WHERE s.mailbox_id = sqlc.arg(mailbox_id)),
    sqlc.arg(name), sqlc.arg(folder), sqlc.arg(uid_validity), sqlc.arg(last_uid)
)
RETURNING *;

-- name: SetMailSourceName :exec
UPDATE mail_sources SET name = ? WHERE id = ?;

-- name: SetMailSourceFolder :exec
-- A new folder is read from its end, and whatever was wrong with the old one
-- is over.
UPDATE mail_sources
SET folder = ?, uid_validity = ?, last_uid = ?, status = 'ok', status_detail = ''
WHERE id = ?;

-- name: SetMailSourceCursor :exec
UPDATE mail_sources SET uid_validity = ?, last_uid = ? WHERE id = ?;

-- name: SetMailSourceAI :exec
UPDATE mail_sources SET ai_mode = ?, ai_account_id = ?, ai_field = ?, ai_senders = ? WHERE id = ?;

-- name: SetMailSourcePosition :exec
UPDATE mail_sources SET position = ? WHERE id = ? AND mailbox_id = ?;

-- name: RecordMailSourceCheck :exec
UPDATE mail_sources
SET last_check_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = ?, status_detail = ?
WHERE id = ?;

-- name: DeleteMailSource :execrows
DELETE FROM mail_sources WHERE id = ? AND mailbox_id = ?;

-- name: FindTransactionByImportRef :one
SELECT id FROM transactions WHERE account_id = ? AND import_ref = ? ORDER BY id LIMIT 1;

-- name: GetAccountFracDigits :one
-- An account's currency decimals, if the account is in the wallet.
SELECT c.frac_digits FROM accounts a JOIN currencies c ON c.id = a.currency_id
WHERE a.id = ? AND a.wallet_id = ?;

-- name: PruneMailMessages :exec
DELETE FROM mail_messages
WHERE mail_messages.mailbox_id = ?
  AND mail_messages.id NOT IN (
    SELECT m.id FROM mail_messages m WHERE m.mailbox_id = ? ORDER BY m.id DESC LIMIT ?
  );
