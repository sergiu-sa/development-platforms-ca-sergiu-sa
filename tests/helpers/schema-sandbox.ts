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
 * Runs `body` against a client whose search_path points at an empty schema
 * named `name`, then drops it.
 *
 * search_path is reset before the connection goes back to the pool. Without
 * that, the next test to borrow the same connection inherits a search_path
 * naming a schema that has just been dropped - which fails in a way that has
 * nothing to do with the test that actually broke.
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
 * A second lock on the same door. Editing the snapshot to silence a drift
 * failure now breaks this instead, which puts a deliberate decision in front
 * of anyone about to disarm the guard - and this line is the one place that
 * says out loud what the frozen shape is.
 */
export const DEPLOYED_AT_PHASE_6_COLUMNS = {
  stories: 9,
  users: 5,
  saved_stories: 5,
} as const;
