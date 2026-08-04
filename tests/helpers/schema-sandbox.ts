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
