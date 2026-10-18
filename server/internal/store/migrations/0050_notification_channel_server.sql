-- The server a channel talks to (#687): a Matrix homeserver today, later an
-- ntfy or Gotify server. Empty where the channel has none, or uses the
-- installation's own (a shared Matrix bot).
ALTER TABLE notification_channels ADD COLUMN server TEXT NOT NULL DEFAULT '';
