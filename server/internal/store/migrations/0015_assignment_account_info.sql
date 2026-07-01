-- Extend assignment rules with an optional account condition (the rule only
-- applies to transactions in that account; NULL = any account) and the ability
-- to set the transaction's info / "number" field.
ALTER TABLE assignments ADD COLUMN match_account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE assignments ADD COLUMN set_info TEXT; -- NULL = don't set
