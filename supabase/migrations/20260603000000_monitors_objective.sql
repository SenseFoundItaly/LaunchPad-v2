-- Add objective TEXT to monitors so each monitor carries a human-readable
-- "why this exists" line alongside its prompt. Powers the new
-- /project/{id}/monitors/{monitorId} detail view and the Inbox proposal
-- review pane. Nullable — existing rows degrade gracefully to deriving the
-- objective from linked_quote / name on read.
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS objective TEXT;
