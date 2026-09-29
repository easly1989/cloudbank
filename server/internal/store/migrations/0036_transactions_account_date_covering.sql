-- The account/date index also carries amount, status and wallet_id, so the
-- per-account sums (running balances, cash flow, uncleared totals, the balance
-- report) read the index alone instead of every matching row (#541). Same name,
-- same leading columns: every query that used it still does.
DROP INDEX idx_transactions_account_date;

CREATE INDEX idx_transactions_account_date ON transactions (account_id, date, amount, status, wallet_id);
