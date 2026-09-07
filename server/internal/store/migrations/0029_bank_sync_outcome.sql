-- Records the outcome of the most recent sync ATTEMPT (manual or background) on a
-- connection, so the UI can show when it last synced and whether it worked. This
-- is separate from last_synced_at, which tracks the last SUCCESSFUL sync and
-- drives the fetch window (it is not advanced when every account fails).
ALTER TABLE bank_connections ADD COLUMN last_sync_at TEXT;
ALTER TABLE bank_connections ADD COLUMN last_sync_status TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_connections ADD COLUMN last_sync_message TEXT NOT NULL DEFAULT '';
