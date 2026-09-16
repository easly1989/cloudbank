-- Dated valuations for asset accounts (property, vehicle, investments, …): a
-- recorded value over time in the account's own currency (minor units). An asset
-- account's current value is its most recent valuation by date; net worth uses
-- that instead of the transaction running total. Cascades away with the account.
CREATE TABLE asset_valuations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    date       TEXT    NOT NULL, -- YYYY-MM-DD
    value      INTEGER NOT NULL, -- minor units, account currency
    note       TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_asset_val_account ON asset_valuations (account_id);
CREATE INDEX idx_asset_val_account_date ON asset_valuations (account_id, date);
