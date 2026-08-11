/**
 * A throwaway Postgres schema to apply DDL into.
 *
 * Several tests need to stand up a wrongly-shaped database on purpose - a
 * stories table from before the wire expansion, or no table at all - and then
 * assert what the real code makes of it. Doing that in the test database
 * itself would destroy the tables every other test relies on.
 *
 * So each case gets its own named schema with search_path pointed at it. The
 * unqualified names in db/schema.sql and in the application's queries then
 * resolve there, and the real tables are never reachable.
 *
 * Shared rather than copied because the search_path line is the only thing
 * standing between these tests and the real stories table, and a guarantee
 * that matters that much should exist once.
 */

import type pg from "pg";
import { pool } from "../../src/db/connection.js";

/** The stories table exactly as it stood before the wire data expansion. */
export const LEGACY_STORIES = `
  CREATE TABLE stories (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id   TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    summary       TEXT,
    url           TEXT NOT NULL,
    section       TEXT,
    thumbnail_url TEXT,
    published_at  TIMESTAMPTZ NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

/**
 * The deployed databases as they stood when phase 6 shipped, before
 * db/schema.sql is applied over them: the pre-expansion stories table, plus
 * saved_stories and the two things it depends on.
 *
 * **Never add a column to this.** It is a frozen historical record, not a
 * mirror of the current schema, and its whole value is that it cannot move.
 * The convergence test compares it against a fresh install, so a column added
 * to a CREATE TABLE block with no matching ALTER shows up as a difference. A
 * developer who hits that failure has two ways to make it green: write the
 * ALTER, which is correct, or add the column here, which turns the guard off
 * permanently for that table and reproduces the phase 1 outage exactly.
 *
 * The name says a date for that reason. The next snapshot, if one is ever
 * needed, is a new constant beside this one rather than an edit to it.
 * `assertFrozen` below is what stops a quiet edit going unnoticed.
 */
export const DEPLOYED_AT_PHASE_6 = [
  LEGACY_STORIES,

  `CREATE TABLE users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    username      VARCHAR(50)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
  )`,

  `DO $$ BEGIN
    CREATE TYPE story_decision AS ENUM ('saved', 'skipped');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,

  `CREATE TABLE saved_stories (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE RESTRICT,
    state      story_decision NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_stories_unique_story UNIQUE (user_id, story_id)
  )`,
].join(";\n");

/**
 * The deployed databases as they stand at phase 8:
 * everything above, plus the two briefings tables.
 *
 * Both have been on production and preview since the Postgres migration and have never changed shape
 *  - checked directly against both rather than assumed, because "it was in the file" is exactly what was believed about phase 1's nine columns.
 * Phase 8 therefore adds no column and needs no ALTER;
 * this snapshot exists so that the *next* phase to add one cannot ship without it.
 *
 * Composed from the phase 6 constant rather than restating it, so there is still only one description of the older tables and it is still frozen.
 */
export const DEPLOYED_AT_PHASE_8 = [
  DEPLOYED_AT_PHASE_6,

  // The two tables the phase 6 snapshot never named.
  // Both were measured against production and preview on 2026-08-08 rather than copied out of db/schema.sql
  //  - a snapshot taken from the file it is meant to be checked against would agree with it by construction and prove nothing.
  `CREATE TABLE auth_attempts (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope        TEXT NOT NULL,
    identifier   TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE wire_sync (
    id                   BOOLEAN PRIMARY KEY DEFAULT TRUE,
    last_attempt_at      TIMESTAMPTZ NOT NULL,
    last_success_at      TIMESTAMPTZ,
    last_error           TEXT,
    rate_limit_remaining INTEGER,
    CONSTRAINT wire_sync_singleton CHECK (id)
  )`,

  `DO $$ BEGIN
    CREATE TYPE briefing_status AS ENUM ('draft', 'published');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,

  `CREATE TABLE briefings (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL,
    intro        TEXT,
    slug         TEXT NOT NULL UNIQUE,
    status       briefing_status NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE INDEX briefings_public_idx
     ON briefings (published_at DESC, id DESC)
     WHERE status = 'published'`,

  `CREATE TABLE briefing_items (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
    story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE RESTRICT,
    note        TEXT,
    position    INTEGER NOT NULL,
    CONSTRAINT briefing_items_unique_story UNIQUE (briefing_id, story_id),
    CONSTRAINT briefing_items_unique_position
      UNIQUE (briefing_id, position) DEFERRABLE INITIALLY IMMEDIATE
  )`,
].join(";\n");

/**
 * Tables the two paths are compared across.
 *
 * stories is here because it has actually gained columns since being deployed.
 * The rest are here because every one of them will one day gain a column too, and the trap springs the first time that happens
 *  - on a database CI never builds, so nothing else would catch it.
 *
 * This is every table db/schema.sql creates, and tests/schema-probes.test.ts asserts that it stays that way.
 * Being complete is what makes the guard stop needing to be remembered;
 *  a list that covers most tables is one that has to be checked by hand, which is the thing that failed in phase 1.
 */
export const TRACKED_TABLES = [
  "users",
  "auth_attempts",
  "stories",
  "wire_sync",
  "saved_stories",
  "briefings",
  "briefing_items",
] as const;

/**
 * Copies a table's shape into the current schema, with no rows.
 *
 * `CREATE TABLE x AS SELECT * FROM public.x WHERE false` was written out eight times across the health tests, latterly in two styles in one case.
 * It is how a probe test stands up a database that is right in every way except the one it is about to break.
 */
export async function cloneTables(
  client: pg.PoolClient,
  ...tables: string[]
): Promise<void> {
  for (const table of tables) {
    await client.query(
      `CREATE TABLE ${table} AS SELECT * FROM public.${table} WHERE false`
    );
  }
}

/**
 * Runs `body` against a client whose search_path points at an empty schema named `name`, then drops it.
 *
 * search_path is reset before the connection goes back to the pool.
 * Without that, the next test to borrow the same connection inherits a search_path naming a schema that has just been dropped - which fails in a way that has nothing to do with the test that actually broke.
 */
export async function inThrowawaySchema<T>(
  name: string,
  body: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await client.query(`CREATE SCHEMA ${name}`);
    await client.query(`SET search_path TO ${name}`);

    return await body(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await client.query("SET search_path TO DEFAULT");
    client.release();
  }
}

/**
 * The column counts the snapshot above is pinned at.
 *
 * A second lock on the same door.
 * Editing the snapshot to silence a drift failure now breaks this instead, which puts a deliberate decision in front of anyone about to disarm the guard
 *  - and this line is the one place that says out loud what the frozen shape is.
 */
export const DEPLOYED_AT_PHASE_6_COLUMNS = {
  stories: 9,
  users: 5,
  saved_stories: 5,
} as const;

/** The same lock over the phase 8 snapshot, which contains the phase 6 one. */
export const DEPLOYED_AT_PHASE_8_COLUMNS = {
  ...DEPLOYED_AT_PHASE_6_COLUMNS,
  auth_attempts: 4,
  wire_sync: 5,
  briefings: 9,
  briefing_items: 5,
} as const;
