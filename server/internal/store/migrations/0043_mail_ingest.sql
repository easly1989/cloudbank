-- Bank-mail reading (#654, #655): a wallet can connect one or more mailboxes,
-- and CloudBank reads the bank's notification mails from one folder of each.
--
-- secret is the credential, sealed with internal/secrets: a Microsoft refresh
-- token today, an app password once plain IMAP lands (#658). The feature
-- refuses to run without CB_SECRET_KEY, so it is never stored in clear.
--
-- uid_validity + last_uid are the read cursor of the chosen folder: only mails
-- with a higher UID are new. A changed UIDVALIDITY restarts the cursor at the
-- folder's current end, so the past is never fetched.
CREATE TABLE mailboxes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id     INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    created_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    provider      TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    secret        TEXT    NOT NULL DEFAULT '',
    folder        TEXT    NOT NULL DEFAULT 'INBOX',
    paused        INTEGER NOT NULL DEFAULT 0,
    uid_validity  INTEGER NOT NULL DEFAULT 0,
    last_uid      INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'ok',
    status_detail TEXT    NOT NULL DEFAULT '',
    last_check_at TEXT,
    last_mail_at  TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mailboxes_wallet ON mailboxes (wallet_id);

-- The mails read from a mailbox. Only the newest 50 per mailbox are kept: the
-- model editor (#657) starts from a real mail and tries a model on the recent
-- ones. received_at is the mail's own Date header with its offset (RFC 3339),
-- so the civil date can be taken in the sender's time zone.
CREATE TABLE mail_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mailbox_id  INTEGER NOT NULL REFERENCES mailboxes (id) ON DELETE CASCADE,
    uid         INTEGER NOT NULL,
    message_id  TEXT    NOT NULL,
    sender      TEXT    NOT NULL DEFAULT '',
    subject     TEXT    NOT NULL DEFAULT '',
    received_at TEXT    NOT NULL,
    body        TEXT    NOT NULL DEFAULT '',
    outcome     TEXT    NOT NULL DEFAULT 'unrecognized',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_mail_messages_mailbox_msgid ON mail_messages (mailbox_id, message_id);
