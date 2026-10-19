-- A channel that sends through one of the installation's own resources (its
-- mail server, its shared Matrix or Telegram bot) gets nothing until its owner
-- proves the address is theirs (#716). verified is 0 while a code is pending:
-- its SHA-256 in code_hash; for Telegram's shared bot the code itself too,
-- sealed, since it goes in the link the page shows.
ALTER TABLE notification_channels ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_channels ADD COLUMN code_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_channels ADD COLUMN code_link TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_channels ADD COLUMN code_expires_at TEXT;
ALTER TABLE notification_channels ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0;
