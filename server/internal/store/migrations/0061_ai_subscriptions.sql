-- The AI's subscription proposals (#699): a switch of their own, off at first.
-- The proposals go in ai_proposals with the kind 'subscriptions'.
ALTER TABLE ai_settings ADD COLUMN subscriptions_on INTEGER NOT NULL DEFAULT 0;
