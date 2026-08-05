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

-- Failed authentication attempts, backing the rate limiter.
--
-- Deliberately in Postgres rather than process memory: the deploy target is
-- Vercel, where each serverless instance has its own memory and cold starts
-- reset it, so an in-memory counter would barely slow an attacker down.
CREATE TABLE IF NOT EXISTS auth_attempts (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_attempts_lookup_idx
  ON auth_attempts (scope, identifier, attempted_at DESC);

-- The five card variants, resolved from the Guardian's tone tags. Storing it
-- as an enum rather than free text means a tone the frontend has no card for
-- cannot reach the table at all.
--
-- Its own DO block on purpose: one block per type. Sharing a block with
-- briefing_status would mean the first duplicate_object aborts the rest,
-- so the second type would silently never be created.
DO $$ BEGIN
  CREATE TYPE story_tone AS ENUM
    ('minutebyminute', 'reviews', 'comment', 'features', 'news');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS stories (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  summary       TEXT,
  standfirst    TEXT,
  byline        TEXT,
  url           TEXT NOT NULL,
  section       TEXT,
  pillar        TEXT,
  tone          story_tone NOT NULL DEFAULT 'news',
  word_count    INTEGER,
  star_rating   SMALLINT,
  -- thumbnail_url is the 500px asset, image_url the 1000px one. The two paths
  -- differ only in their final segment, so they are served as a srcset.
  thumbnail_url TEXT,
  image_url     TEXT,
  image_alt     TEXT,
  image_credit  TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS leaves an existing table untouched, so on a
-- database that already holds stories the columns above are reached only
-- through these. Both halves are load-bearing: the definition above builds
-- fresh installs and the test database, these migrate the deployed one.
--
-- Every added column is nullable or defaulted because the live table has rows
-- that predate all of them. image_url in particular is guaranteed by the
-- Guardian client - a story without an image is dropped rather than stored -
-- but it cannot be NOT NULL here without breaking the re-apply.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS standfirst   TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS byline       TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS pillar       TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS tone         story_tone NOT NULL
  DEFAULT 'news';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS word_count   INTEGER;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS star_rating  SMALLINT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_url    TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_alt    TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_credit TEXT;

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

-- What a reader has done with a story on the deck. An enum rather than text
-- for the same reason story_tone is one: the frontend understands exactly two
-- states, so a third should not be storable.
--
-- Its own DO block, per the rule above.
DO $$ BEGIN
  CREATE TYPE story_decision AS ENUM ('saved', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The desk: every decision a reader has made, saved and skipped alike.
--
-- Skips are stored, not just saves. Without them, signing in on a second
-- device re-deals every story the reader has already dismissed, which is the
-- one thing the deck exists to avoid.
--
-- No index beyond the unique constraint. UNIQUE (user_id, story_id) builds a
-- btree with user_id leading, so "everything on my desk" already has one.
CREATE TABLE IF NOT EXISTS saved_stories (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- RESTRICT for the same reason briefing_items uses it: a story on somebody's
  -- desk must be impossible to prune from the cache.
  --
  -- A foreign key cannot be conditional on a column value, so this pins
  -- skipped stories exactly as hard as saved ones - and skips are the common
  -- case, since the deck offers every story and most get skipped. One reader
  -- working through the wire therefore pins very nearly all of it.
  --
  -- So pruning stale stories is not "delete the old rows"; it is "delete the
  -- skipped rows for every user, then delete the stories". Worth knowing
  -- before anyone writes that DELETE and reads the failure as a bug.
  story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE RESTRICT,
  state      story_decision NOT NULL,
  -- decided_at rather than saved_at: a skipped row was never saved, and the
  -- desk orders by this column.
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT saved_stories_unique_story UNIQUE (user_id, story_id)
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
