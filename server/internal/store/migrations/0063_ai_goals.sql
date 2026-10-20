-- The AI's goal proposals (#699): a switch of their own, off at first. The
-- proposals go in ai_proposals with the kind 'goals'.
ALTER TABLE ai_settings ADD COLUMN goals_on INTEGER NOT NULL DEFAULT 0;
