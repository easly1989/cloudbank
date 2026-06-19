-- Add an import reference (e.g. an OFX FITID) so re-importing the same file can
-- detect already-imported transactions. Empty for manually-entered rows.
ALTER TABLE transactions ADD COLUMN import_ref TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_transactions_import_ref
    ON transactions (account_id, import_ref);
