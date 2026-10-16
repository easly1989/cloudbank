-- name: InsertMailbox :one
INSERT INTO mailboxes (wallet_id, created_by, provider, address, secret)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: GetMailbox :one
SELECT * FROM mailboxes WHERE id = ? AND wallet_id = ? LIMIT 1;

-- name: FindMailboxByAddress :one
SELECT * FROM mailboxes WHERE wallet_id = ? AND provider = ? AND address = ? LIMIT 1;

-- name: ListMailboxesForWallet :many
SELECT * FROM mailboxes WHERE wallet_id = ? ORDER BY created_at, id;

-- name: ListMailboxesToWatch :many
-- Every mailbox the listener should keep open: not paused, and not waiting for
-- a new sign-in, across all wallets.
SELECT * FROM mailboxes WHERE paused = 0 AND status != 'reauth' ORDER BY id;

-- name: SetMailboxAlerted :execrows
-- Changes the flag only when it differs, so the caller learns from the row
-- count whether this is the moment it changed.
UPDATE mailboxes SET alerted = ? WHERE id = ? AND alerted != ?;

-- name: DeleteMailbox :execrows
DELETE FROM mailboxes WHERE id = ? AND wallet_id = ?;

-- name: SetMailboxSecret :exec
UPDATE mailboxes SET secret = ? WHERE id = ?;

-- name: SetMailboxFolder :exec
UPDATE mailboxes SET folder = ?, uid_validity = ?, last_uid = ? WHERE id = ?;

-- name: SetMailboxPaused :exec
UPDATE mailboxes SET paused = ? WHERE id = ?;

-- name: SetMailboxCursor :exec
UPDATE mailboxes SET uid_validity = ?, last_uid = ? WHERE id = ?;

-- name: RecordMailboxCheck :exec
UPDATE mailboxes
SET last_check_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = ?, status_detail = ?
WHERE id = ?;

-- name: TouchMailboxLastMail :exec
UPDATE mailboxes SET last_mail_at = ? WHERE id = ?;

-- name: InsertMailMessage :execrows
INSERT INTO mail_messages (mailbox_id, uid, message_id, sender, subject, received_at, body)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (mailbox_id, message_id) DO NOTHING;

-- name: ListMailMessages :many
SELECT id, mailbox_id, uid, message_id, sender, subject, received_at, outcome, created_at
FROM mail_messages WHERE mailbox_id = ? ORDER BY id DESC LIMIT ?;

-- name: PruneMailMessages :exec
DELETE FROM mail_messages
WHERE mail_messages.mailbox_id = ?
  AND mail_messages.id NOT IN (
    SELECT m.id FROM mail_messages m WHERE m.mailbox_id = ? ORDER BY m.id DESC LIMIT ?
  );
