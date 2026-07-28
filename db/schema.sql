-- Postgres schema for the news platform.
-- Loaded by tests via createSchema() and used for fresh local installs.
-- Safe to run repeatedly.

-- ENUM has no IF NOT EXISTS, so guard it explicitly.
DO $$ BEGIN
  CREATE TYPE briefing_status AS ENUM ('draft', 'published');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- MySQL's utf8mb4_0900_ai_ci collation made both of these comparisons
-- case-insensitive for free. Postgres compares case-sensitively, so without
-- these indexes the migration silently changes behaviour: Alice@x.com and
-- alice@x.com would become two accounts, and "Alice" could shadow "alice"
-- on a byline.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
  ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
  ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS stories (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  summary       TEXT,
  url           TEXT NOT NULL,
  section       TEXT,
  thumbnail_url TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stories_recent_idx
  ON stories (published_at DESC, id DESC);

-- Bookkeeping for the wire cache. One row, ever: a BOOLEAN primary key with a
-- CHECK that it is TRUE makes a second row unrepresentable.
--
-- last_attempt_at tracks attempts rather than successes on purpose. Freshness
-- alone would mean an upstream outage never advances the clock, so every
-- request retries the Guardian and drains the 500/day budget in minutes.
CREATE TABLE IF NOT EXISTS wire_sync (
  id                   BOOLEAN PRIMARY KEY DEFAULT TRUE,
  last_attempt_at      TIMESTAMPTZ NOT NULL,
  last_success_at      TIMESTAMPTZ,
  last_error           TEXT,
  rate_limit_remaining INTEGER,

  CONSTRAINT wire_sync_singleton CHECK (id)
);

CREATE TABLE IF NOT EXISTS briefings (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  intro        TEXT,
  slug         TEXT NOT NULL UNIQUE,
  status       briefing_status NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS briefings_public_idx
  ON briefings (published_at DESC, id DESC)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS briefing_items (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  -- RESTRICT enforces "a referenced story is never pruned" in the database
  -- rather than in application code, so cache cleanup physically cannot
  -- break a published briefing.
  story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE RESTRICT,
  note        TEXT,
  position    INTEGER NOT NULL,

  CONSTRAINT briefing_items_unique_story
    UNIQUE (briefing_id, story_id),
  -- DEFERRABLE because reordering swaps positions inside a transaction and
  -- would otherwise trip the constraint mid-update.
  CONSTRAINT briefing_items_unique_position
    UNIQUE (briefing_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
