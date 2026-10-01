-- A goal can be closed (#572): reached and done with, or given up on. A closed
-- goal moves to the history and stops counting as money set aside; NULL means
-- open. Whether it was reached follows from its contributions, so only the
-- civil date it was closed on is stored.
ALTER TABLE goals ADD COLUMN closed_on TEXT;
