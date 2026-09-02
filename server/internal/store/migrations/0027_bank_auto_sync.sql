-- Per-connection automatic (background) sync toggle. On by default, so a newly
-- connected bank is kept up to date on the server's schedule; turn it off to sync
-- a connection only on demand via "Sync now".
ALTER TABLE bank_connections ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 1;
