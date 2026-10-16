-- Bank mails, listening (#656): whether the person who connected a mailbox has
-- been told it stopped working. Set when a sign-in fails, cleared by the next
-- check that works, so one failure sends one push however often it is retried.
ALTER TABLE mailboxes ADD COLUMN alerted INTEGER NOT NULL DEFAULT 0;
