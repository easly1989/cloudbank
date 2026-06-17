-- Per-category monthly budgets. A category is budgeted either "same every
-- month" (a single row with month = 0) or with up to twelve per-month rows
-- (month 1..12). Amounts are signed minor units in the base currency.
CREATE TABLE budgets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id   INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    month       INTEGER NOT NULL,   -- 0 = same every month, 1..12 = that month
    amount      INTEGER NOT NULL,
    UNIQUE (category_id, month)
);

CREATE INDEX idx_budgets_wallet ON budgets (wallet_id);
