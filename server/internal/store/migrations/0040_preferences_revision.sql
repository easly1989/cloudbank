-- A revision for each user's preferences (#576). It goes up with every save;
-- a client that sends the revision it started from is refused when another tab
-- or device saved in between, instead of silently undoing that save.
ALTER TABLE users ADD COLUMN preferences_rev INTEGER NOT NULL DEFAULT 0;
