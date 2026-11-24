-- The bank's BIC/SWIFT code beside the IBAN (#775). A bank account keeps its
-- IBAN in `number`, the field HomeBank calls the account number, so an .xhb
-- round trip carries it; the BIC has no HomeBank field and stays here only.
ALTER TABLE accounts ADD COLUMN bic TEXT NOT NULL DEFAULT '';
