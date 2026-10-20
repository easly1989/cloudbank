-- The AI's savings proposals (#699): a switch of their own, off at first.
-- The proposals go in ai_proposals with the kind 'savings'.
ALTER TABLE ai_settings ADD COLUMN savings_on INTEGER NOT NULL DEFAULT 0;
