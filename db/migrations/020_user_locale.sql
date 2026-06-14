-- ============================================================================
-- 020: account-wide language preference on users
-- ----------------------------------------------------------------------------
-- Until now `locale` lived only on `projects` (set once at creation from the
-- partner config, never updatable). The app gains a per-user language switch
-- that applies across every project the user owns, so the durable home for the
-- preference is the `users` shadow row — mirroring the existing
-- `preferred_model` column.
--
-- Resolution order at read time (see src/lib/i18n/resolve-locale.ts):
--   users.locale  >  projects.locale  >  'en'
--
-- Additive + idempotent. NULL is treated as "unset" → falls through to the
-- project locale, then the product default ('en').
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR;

COMMENT ON COLUMN users.locale IS 'Account-wide UI + agent language (BCP-47 short code, e.g. en/it/fr/es/de). NULL = unset, falls back to project locale then ''en''.';
