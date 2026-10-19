-- Recurring payments the reader chose not to schedule (#693): one payee at
-- one cadence, per wallet. A new cadence for the same payee is proposed again.
CREATE TABLE recurring_ignored (
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    payee_id  INTEGER NOT NULL REFERENCES payees (id) ON DELETE CASCADE,
    cadence   TEXT    NOT NULL,
    PRIMARY KEY (wallet_id, payee_id, cadence)
);
