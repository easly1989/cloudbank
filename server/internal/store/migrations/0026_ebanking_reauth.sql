-- Reconnecting an Enable Banking bank re-uses the existing connection. The pending
-- authorization records which connection it re-authorizes (0 = a brand-new
-- connection), so the callback refreshes that connection's session in place
-- instead of creating a duplicate — keeping its account links.
ALTER TABLE bank_ebanking_auth ADD COLUMN connection_id INTEGER NOT NULL DEFAULT 0;
