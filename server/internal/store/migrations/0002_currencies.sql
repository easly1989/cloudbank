-- Per-wallet currencies. Each wallet has one base currency (is_base = 1) whose
-- rate is always 1; other currencies store a manual or fetched rate expressing
-- the value of ONE unit of this currency in the base currency.
CREATE TABLE currencies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id       INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    iso_code        TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    symbol          TEXT    NOT NULL DEFAULT '',
    symbol_prefix   INTEGER NOT NULL DEFAULT 0,  -- 1 = symbol before the amount
    decimal_char    TEXT    NOT NULL DEFAULT '.',
    group_char      TEXT    NOT NULL DEFAULT ',',
    frac_digits     INTEGER NOT NULL DEFAULT 2,
    is_base         INTEGER NOT NULL DEFAULT 0,
    rate            REAL    NOT NULL DEFAULT 1,   -- value of 1 unit in base currency
    rate_updated_at TEXT,
    UNIQUE (wallet_id, iso_code)
);

CREATE INDEX idx_currencies_wallet ON currencies (wallet_id);

-- History of exchange-rate changes (manual or fetched). currencies.rate holds
-- the latest value; this table keeps the trail.
CREATE TABLE exchange_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_id INTEGER NOT NULL REFERENCES currencies (id) ON DELETE CASCADE,
    date        TEXT    NOT NULL,                -- YYYY-MM-DD
    rate        REAL    NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'manual', -- 'manual' | 'frankfurter'
    UNIQUE (currency_id, date)
);

CREATE INDEX idx_exchange_rates_currency ON exchange_rates (currency_id);
