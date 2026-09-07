-- Per-connection auto-sync cadence. PSD2/Berlin-Group unattended access is capped
-- to a handful of calls per account per day, so there is no benefit to syncing
-- more than about once a day — the default is daily, and the user can relax it
-- further (every 2 days, weekly, …) per connection. The background job compares
-- each connection's own interval against last_synced_at to decide when it is due.
ALTER TABLE bank_connections ADD COLUMN sync_interval_hours INTEGER NOT NULL DEFAULT 24;
