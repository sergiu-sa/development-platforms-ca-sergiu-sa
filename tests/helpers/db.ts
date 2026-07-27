/**
 * Test database helpers.
 *
 * Tests run against a real Postgres database rather than mocks, so they
 * exercise the actual SQL. That makes the reset logic destructive, hence the
 * guard below.
 */

import { readFileSync } from "node:fs";
import { pool } from "../../src/db/connection.js";
import { config, databaseNameFromUrl } from "../../src/config/env.js";

// Safety rail: resetDatabase() truncates every table, so refuse outright to
// point at anything that is not explicitly a test database. Without this, a
// missing .env.test would silently fall through to the development database
// and wipe it.
const databaseName = databaseNameFromUrl(config.databaseUrl);

if (!databaseName.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests against database "${databaseName}". ` +
      `The test database name must end with "_test". ` +
      `Copy .env.test.example to .env.test and point DATABASE_URL at news_api_test.`
  );
}

/** Creates the schema from the single source of truth in db/schema.sql. */
export async function createSchema(): Promise<void> {
  await pool.query(readFileSync("db/schema.sql", "utf8"));
}

/** Empties every table so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  await pool.query(
    "TRUNCATE TABLE briefing_items, briefings, stories, users RESTART IDENTITY CASCADE"
  );
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
