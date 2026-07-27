-- Adds a public display name so article authorship stops leaking email
-- addresses to anonymous visitors.
--
-- Apply to an existing database with:
--   mysql -u root -p news_api < db/migrations/001-add-username.sql

-- 1. Add nullable first, so existing rows survive the ALTER.
ALTER TABLE users
  ADD COLUMN username VARCHAR(50) NULL AFTER email;

-- 2. Backfill from the email local part, stripped of anything outside the
--    allowed character set. The id suffix only kicks in when two addresses
--    share a local part (alice@a.com and alice@b.com), which the UNIQUE index
--    added below would otherwise reject.
UPDATE users AS target
JOIN (
  SELECT
    id,
    REGEXP_REPLACE(SUBSTRING_INDEX(email, '@', 1), '[^a-zA-Z0-9_-]', '') AS base
  FROM users
) AS derived ON derived.id = target.id
SET target.username = CASE
  WHEN CHAR_LENGTH(derived.base) < 3 THEN CONCAT('user_', target.id)
  WHEN (
    SELECT COUNT(*)
    FROM (SELECT email FROM users) AS peers
    WHERE REGEXP_REPLACE(SUBSTRING_INDEX(peers.email, '@', 1), '[^a-zA-Z0-9_-]', '') = derived.base
  ) > 1 THEN CONCAT(derived.base, '_', target.id)
  ELSE derived.base
END;

-- 3. Now that every row has a value, enforce the constraints.
ALTER TABLE users
  MODIFY COLUMN username VARCHAR(50) NOT NULL,
  ADD UNIQUE KEY uniq_users_username (username);
