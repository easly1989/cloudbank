-- Bank mails, several sources per mailbox (#794): a source is one folder of a
-- mailbox, read with its own patterns and its own AI settings, and listened to
-- on its own connection. A mailbox has 1 to 5 of them; a mail goes to the
-- first source, in position order, that would read it.
--
-- The mailbox keeps the connection and the login (secret, IMAP settings,
-- status, alerted, paused). Its folder, uid_validity, last_uid and ai_*
-- columns are no longer read or written: they moved to mail_sources. They stay
-- because dropping them means rebuilding mailboxes, and with foreign keys on
-- that would cascade-delete every pattern and mail.
--
-- status is the folder's own: 'error' when it cannot be opened (deleted or
-- renamed). Trouble with the connection or the login stays on the mailbox.
CREATE TABLE mail_sources (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    mailbox_id    INTEGER NOT NULL REFERENCES mailboxes (id) ON DELETE CASCADE,
    position      INTEGER NOT NULL DEFAULT 0,
    name          TEXT    NOT NULL,
    folder        TEXT    NOT NULL DEFAULT 'INBOX',
    uid_validity  INTEGER NOT NULL DEFAULT 0,
    last_uid      INTEGER NOT NULL DEFAULT 0,
    ai_mode       TEXT    NOT NULL DEFAULT 'patterns',
    ai_account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    ai_field      TEXT    NOT NULL DEFAULT 'memo',
    ai_senders    TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'ok',
    status_detail TEXT    NOT NULL DEFAULT '',
    last_check_at TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mail_sources_mailbox ON mail_sources (mailbox_id, position);

-- A pattern belongs to one source and goes with it. mailbox_id stays, set as
-- before.
ALTER TABLE mail_patterns ADD COLUMN source_id INTEGER REFERENCES mail_sources (id) ON DELETE CASCADE;
CREATE INDEX idx_mail_patterns_source ON mail_patterns (source_id, position);

-- The source that read a mail, NULL once that source is removed (the mail
-- stays in the history), and the folder it was found in. Mails stay unique
-- per mailbox by Message-ID.
ALTER TABLE mail_messages ADD COLUMN source_id INTEGER REFERENCES mail_sources (id) ON DELETE SET NULL;
ALTER TABLE mail_messages ADD COLUMN folder TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_mail_messages_source ON mail_messages (source_id);

-- One source per existing mailbox, named after its folder, carrying its
-- cursor and its AI settings, so nothing is read twice or missed.
INSERT INTO mail_sources (mailbox_id, position, name, folder, uid_validity, last_uid,
                          ai_mode, ai_account_id, ai_field, ai_senders, last_check_at)
SELECT id, 0, folder, folder, uid_validity, last_uid, ai_mode, ai_account_id, ai_field, ai_senders, last_check_at
FROM mailboxes;

UPDATE mail_patterns
SET source_id = (SELECT s.id FROM mail_sources s WHERE s.mailbox_id = mail_patterns.mailbox_id);

UPDATE mail_messages
SET source_id = (SELECT s.id FROM mail_sources s WHERE s.mailbox_id = mail_messages.mailbox_id),
    folder    = (SELECT m.folder FROM mailboxes m WHERE m.id = mail_messages.mailbox_id);
