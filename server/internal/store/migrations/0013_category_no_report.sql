-- Per-category "exclude from reports" flag (mirrors accounts.no_report). When
-- set, the category's transactions are left out of the Statistics and Trend
-- reports and the dashboard income/expense and top-categories widgets.
ALTER TABLE categories ADD COLUMN no_report INTEGER NOT NULL DEFAULT 0;
