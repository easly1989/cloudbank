-- Two-level categories (a category with a NULL parent_id is top-level; one with
-- a parent is a subcategory). Depth is capped at 2 in the application. A
-- subcategory inherits its parent's income/expense type.
CREATE TABLE categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
    name      TEXT    NOT NULL,
    is_income INTEGER NOT NULL DEFAULT 0,
    no_budget INTEGER NOT NULL DEFAULT 0,
    UNIQUE (wallet_id, parent_id, name)
);

CREATE INDEX idx_categories_wallet ON categories (wallet_id);

CREATE INDEX idx_categories_parent ON categories (parent_id);

-- Payees, each with an optional default category and default payment mode.
CREATE TABLE payees (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id            INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    name                 TEXT    NOT NULL,
    default_category_id  INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    default_payment_mode INTEGER,
    UNIQUE (wallet_id, name)
);

CREATE INDEX idx_payees_wallet ON payees (wallet_id);
