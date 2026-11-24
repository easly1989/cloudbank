-- Rows of the review's "not confirmed by the bank" list that someone in the
-- wallet put off until a day (#775): the review leaves them out until then, for
-- everyone in the wallet. A reversal pair stays out while either of its rows
-- is snoozed. Deleting the transaction removes its snooze; a past day is simply ignored.
CREATE TABLE review_snoozes (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions (id) ON DELETE CASCADE,
    wallet_id      INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    until          TEXT NOT NULL
);

CREATE INDEX idx_review_snoozes_wallet ON review_snoozes (wallet_id);
