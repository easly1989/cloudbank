-- The AI's rule proposals (#705): a switch of their own, off at first. The
-- proposals go in ai_proposals with the kind 'rules'.
ALTER TABLE ai_settings ADD COLUMN rules_on INTEGER NOT NULL DEFAULT 0;
