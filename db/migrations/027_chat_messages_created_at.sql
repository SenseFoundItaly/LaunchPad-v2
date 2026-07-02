-- chat_messages.created_at reconciliation (audit #143).
--
-- Prod has a `created_at` column but db/schema.sql + a fresh DB do not: INSERTs
-- write the `timestamp` column while every read in the chat route orders and
-- filters by `created_at`. On a clean schema that read path breaks. Add the
-- column (idempotent — a no-op on prod where it already exists) and backfill it
-- from `timestamp` so prod and a fresh DB agree. New rows get the default.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
UPDATE chat_messages SET created_at = "timestamp" WHERE created_at IS NULL;
