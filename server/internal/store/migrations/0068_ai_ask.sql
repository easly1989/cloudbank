-- The AI's answers to questions about a wallet's data (#704): its switch.
ALTER TABLE ai_settings ADD COLUMN ask_on INTEGER NOT NULL DEFAULT 0;
