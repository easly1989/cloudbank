-- Per-connection auto-sync schedule: an hour of day (UTC, 0-23) and a bitmask of
-- weekdays it may run on (bit i = weekday i, 0=Sunday .. 6=Saturday; 127 = every
-- day). This supersedes the coarse sync_interval_hours (kept as a now-unused
-- column) so the user can choose exactly when a connection syncs. The background
-- job runs each due connection at most once per scheduled day, at/after its hour.
ALTER TABLE bank_connections ADD COLUMN sync_hour INTEGER NOT NULL DEFAULT 3;
ALTER TABLE bank_connections ADD COLUMN sync_days INTEGER NOT NULL DEFAULT 127;
