-- First-login product-tour gate. Existing users are marked onboarded so only
-- genuinely-new signups see the tour; new users default to false (tour shows once).
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET onboarded = true WHERE onboarded = false;
