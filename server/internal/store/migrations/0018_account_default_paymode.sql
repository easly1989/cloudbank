-- Per-account default payment mode (HomeBank paymodes 0..11). Pre-fills the
-- payment mode when adding a transaction in the account (e.g. Direct Debit for a
-- bank account, Credit Card for a card). A chosen payee's own default still
-- wins. 0 (None) keeps the previous behaviour; .xhb import leaves it at 0.
ALTER TABLE accounts ADD COLUMN default_payment_mode INTEGER NOT NULL DEFAULT 0;
