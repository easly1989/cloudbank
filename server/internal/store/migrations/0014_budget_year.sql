-- Add a per-year dimension to budgets so a category's budget can differ by
-- calendar year. year = 0 means "every year" (the previous behaviour and the
-- fallback). The UNIQUE constraint must include year, so the table is rebuilt
-- (SQLite can't drop a constraint-backed index in place); existing rows are
-- preserved as year = 0.
CREATE TABLE budgets_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id   INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    year        INTEGER NOT NULL DEFAULT 0,  -- 0 = every year, else a calendar year
    month       INTEGER NOT NULL,            -- 0 = same every month, 1..12 = that month
    amount      INTEGER NOT NULL,
    UNIQUE (category_id, year, month)
);

INSERT INTO budgets_new (id, wallet_id, category_id, year, month, amount)
    SELECT id, wallet_id, category_id, 0, month, amount FROM budgets;

DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;
CREATE INDEX idx_budgets_wallet ON budgets (wallet_id);
