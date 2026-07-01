-- Vehicles as first-class entities for the car-cost report. A fuel/expense
-- transaction can be linked to a vehicle; the vehicle report then aggregates a
-- single vehicle's fuel entries (odometer/volume still parsed from the memo
-- d=/v=/p= grammar, HomeBank-style).
CREATE TABLE vehicles (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    name      TEXT    NOT NULL,
    plate     TEXT    NOT NULL DEFAULT '',
    notes     TEXT    NOT NULL DEFAULT '',
    UNIQUE (wallet_id, name)
);

ALTER TABLE transactions ADD COLUMN vehicle_id INTEGER REFERENCES vehicles (id) ON DELETE SET NULL;
CREATE INDEX idx_transactions_vehicle ON transactions (vehicle_id);
