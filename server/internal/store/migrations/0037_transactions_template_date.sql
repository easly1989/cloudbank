-- The schedules calendar (#546) finds the transactions each template registered
-- in a date range. Without an index on template_id that is a walk over every
-- transaction of the wallet; it also makes deleting a template (whose
-- transactions go back to template_id NULL) look each one up instead of
-- scanning the table.
CREATE INDEX idx_transactions_template_date ON transactions (template_id, date);
