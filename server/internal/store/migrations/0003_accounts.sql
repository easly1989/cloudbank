-- Accounts hold transactions. Every HomeBank account type is supported. Each
-- account has its own currency (a wallet currency). Balances are int64 minor
-- units in that currency.
CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id       INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    type            TEXT    NOT NULL,  -- bank|cash|checking|savings|creditcard|liability|asset|investment
    currency_id     INTEGER NOT NULL REFERENCES currencies (id),
    institution     TEXT    NOT NULL DEFAULT '',
    number          TEXT    NOT NULL DEFAULT '',
    initial_balance INTEGER NOT NULL DEFAULT 0,  -- minor units
    minimum_balance INTEGER NOT NULL DEFAULT 0,  -- overdraft warning threshold (minor units)
    closed          INTEGER NOT NULL DEFAULT 0,
    no_summary      INTEGER NOT NULL DEFAULT 0,  -- exclude from the dashboard summary
    no_budget       INTEGER NOT NULL DEFAULT 0,  -- exclude from budgets
    no_report       INTEGER NOT NULL DEFAULT 0,  -- exclude from reports
    position        INTEGER NOT NULL DEFAULT 0,
    group_name      TEXT    NOT NULL DEFAULT '',
    notes           TEXT    NOT NULL DEFAULT '',
    website         TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (wallet_id, name)
);

CREATE INDEX idx_accounts_wallet ON accounts (wallet_id);

CREATE INDEX idx_accounts_currency ON accounts (currency_id);
