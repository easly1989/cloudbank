-- The AI's receipt reading (#707): its switch.
ALTER TABLE ai_settings ADD COLUMN receipts_on INTEGER NOT NULL DEFAULT 0;
