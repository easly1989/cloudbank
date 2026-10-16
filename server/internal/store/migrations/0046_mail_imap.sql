-- Bank mails over IMAP with an app password (#658): where the mail server is,
-- how the connection is encrypted ('tls' on connect, or 'starttls'), and the
-- name to log in with, which is the address unless the provider wants another.
-- A Microsoft mailbox leaves them empty: its server and login are fixed. The
-- app password itself goes in secret, sealed like the Microsoft token.
ALTER TABLE mailboxes ADD COLUMN imap_host TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes ADD COLUMN imap_port INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mailboxes ADD COLUMN imap_security TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes ADD COLUMN imap_username TEXT NOT NULL DEFAULT '';
