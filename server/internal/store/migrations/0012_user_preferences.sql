-- Per-user preferences stored as a small JSON blob (date format, default
-- account, start screen, ...). Language and theme remain dedicated columns.
ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}';
