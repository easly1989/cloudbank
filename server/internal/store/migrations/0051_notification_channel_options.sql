-- A channel's own options (#688), as JSON: for Telegram the topic of a group
-- with topics and whether to send without sound. Empty for none.
ALTER TABLE notification_channels ADD COLUMN options TEXT NOT NULL DEFAULT '';
