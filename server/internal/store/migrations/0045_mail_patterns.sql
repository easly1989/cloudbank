-- Bank mails, patterns (#657): how to read each kind of bank mail, and what
-- became of every mail read.
--
-- A pattern belongs to a mailbox and is tried in position order; the first
-- that reads a mail wins. body is an RE2 expression with named groups
-- (amount, memo, payee, info, tag, category, date, card, direction) matched
-- against the mail's subject, a newline and its body. cards is a JSON list of
-- {digits, accountId}. editor is the editor's own state, opaque to the server.
CREATE TABLE mail_patterns (
    id           INTEGER PRIMARY KEY,
    mailbox_id   INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    name         TEXT    NOT NULL DEFAULT '',
    sender       TEXT    NOT NULL,
    subject_mode TEXT    NOT NULL DEFAULT '',
    subject      TEXT    NOT NULL DEFAULT '',
    body         TEXT    NOT NULL,
    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    cards        TEXT    NOT NULL DEFAULT '[]',
    direction    TEXT    NOT NULL DEFAULT 'out',
    in_words     TEXT    NOT NULL DEFAULT '',
    payment_mode INTEGER NOT NULL DEFAULT 0,
    apply_rules  INTEGER NOT NULL DEFAULT 1,
    date_format  TEXT    NOT NULL DEFAULT '',
    require_auth INTEGER NOT NULL DEFAULT 1,
    editor       TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX mail_patterns_mailbox ON mail_patterns (mailbox_id, position);

-- What became of each mail: outcome is unrecognized, unverified (a pattern
-- would have read it, but the sender was not authenticated), created (with
-- the transaction), duplicate or failed (with the reason in detail).
ALTER TABLE mail_messages ADD COLUMN authenticated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_messages ADD COLUMN detail TEXT NOT NULL DEFAULT '';
ALTER TABLE mail_messages ADD COLUMN pattern_id INTEGER REFERENCES mail_patterns(id) ON DELETE SET NULL;
ALTER TABLE mail_messages ADD COLUMN transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;
