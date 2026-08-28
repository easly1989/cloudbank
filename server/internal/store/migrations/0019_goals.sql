-- Savings goals ("piggy banks"): a manual target you top up / draw down by hand.
-- A goal's saved amount is the sum of its contributions; progress = saved /
-- target. Amounts are in the wallet's base currency. An optional account link is
-- for reference only (ON DELETE SET NULL keeps the goal if the account is gone).
CREATE TABLE goals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id     INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    target_amount INTEGER NOT NULL,
    target_date   TEXT,
    account_id    INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    note          TEXT    NOT NULL DEFAULT '',
    position      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_goals_wallet ON goals (wallet_id);

-- Signed contributions: positive = added, negative = withdrawn.
CREATE TABLE goal_contributions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
    date    TEXT    NOT NULL,
    amount  INTEGER NOT NULL,
    note    TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_goal_contrib_goal ON goal_contributions (goal_id);
