-- Bank mails read by AI (#659), as a fallback to the patterns or instead of
-- them. ai_mode is the order: 'patterns' (no AI), 'patterns_ai', 'ai_patterns'
-- or 'ai'. The AI never chooses the account: ai_account_id is where what it
-- reads goes, and ai_field the field its description fills ('memo' or
-- 'payee'). Only mails from ai_senders (addresses or domains, comma-separated)
-- are ever sent to the AI provider.
ALTER TABLE mailboxes ADD COLUMN ai_mode TEXT NOT NULL DEFAULT 'patterns';
ALTER TABLE mailboxes ADD COLUMN ai_account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE mailboxes ADD COLUMN ai_field TEXT NOT NULL DEFAULT 'memo';
ALTER TABLE mailboxes ADD COLUMN ai_senders TEXT NOT NULL DEFAULT '';

-- Whether the AI, not a pattern, read the mail, for the history.
ALTER TABLE mail_messages ADD COLUMN by_ai INTEGER NOT NULL DEFAULT 0;
