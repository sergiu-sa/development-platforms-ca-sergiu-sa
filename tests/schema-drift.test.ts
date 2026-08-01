/**
 * Schema drift tests.
 *
 * db/schema.sql declares the stories columns twice and both have to stay in
 * step:
 *
 *   - CREATE TABLE IF NOT EXISTS builds fresh installs and the test database
 *   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS migrates a database that
 *     already holds stories, because CREATE TABLE IF NOT EXISTS leaves an
 *     existing table completely untouched
 *
 * The duplication is deliberate, but it is the same shape as the CSP being
 * declared in two files, and it fails the same way: add a column to the
 * CREATE TABLE block alone and it appears locally and in CI - where the table
 * is always built from scratch - while being silently absent in production,
 * which is the only place the ALTER path runs.
 *
 * So rather than compare the two declarations as text, these apply the real
 * file down both paths and assert they converge. Each runs inside its own
 * Postgres schema on one connection with search_path pointed at it, so the
 * unqualified names in db/schema.sql resolve there and the real tables are
 * never touched.
 */

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { pool } from "../src/db/connection.js";
import { closeDatabase } from "./helpers/db.js";

const schemaSql = readFileSync("db/schema.sql", "utf8");

/** The stories table exactly as it stood before the wire data expansion. */
const LEGACY_STORIES = `
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

interface AppliedSchema {
  columns: string[];
  /** The tone of the row seeded before migrating, if one was seeded. */
  seededTone: string | null;
}

/**
 * Applies db/schema.sql inside a throwaway Postgres schema and reports the
 * columns stories ends up with. `before` runs first, so a caller can stand up
 * the old table and exercise the migration path.
 */
async function applySchemaIn(
  name: "drift_fresh" | "drift_legacy",
  before?: string
): Promise<AppliedSchema> {
  const client = await pool.connect();

  try {
    await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await client.query(`CREATE SCHEMA ${name}`);
    // Unqualified names in db/schema.sql now resolve inside this schema.
    await client.query(`SET search_path TO ${name}`);

    let seededTone: string | null = null;

    if (before) {
      await client.query(before);
      await client.query(
        `INSERT INTO stories (external_id, title, url, published_at)
         VALUES ('legacy-row', 'A story stored before the expansion',
                 'https://example.com/legacy', now())`
      );
    }

    await client.query(schemaSql);

    if (before) {
      const { rows } = await client.query<{ tone: string }>(
        "SELECT tone FROM stories WHERE external_id = 'legacy-row'"
      );
      seededTone = rows[0]?.tone ?? null;
    }

    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'stories'
        ORDER BY column_name`,
      [name]
    );

    return { columns: rows.map((row) => row.column_name), seededTone };
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    client.release();
  }
}

afterAll(closeDatabase);

describe("db/schema.sql applied to an existing database", () => {
  it("reaches the same stories columns as a fresh install", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const migrated = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    const missing = fresh.columns.filter(
      (column) => !migrated.columns.includes(column)
    );

    expect(
      missing,
      "These columns are in the CREATE TABLE block but no ALTER TABLE adds " +
        "them, so a database that already holds stories will never get them:\n  " +
        missing.join("\n  ")
    ).toEqual([]);

    expect(migrated.columns).toEqual(fresh.columns);
  });

  // Guards the assertion above against passing vacuously: if stories were not
  // created at all, both column lists would be empty and equal.
  it("actually adds the widened columns down both paths", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const migrated = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    for (const column of [
      "standfirst",
      "byline",
      "pillar",
      "tone",
      "word_count",
      "star_rating",
      "image_url",
      "image_alt",
      "image_credit",
    ]) {
      expect(fresh.columns, `fresh install is missing ${column}`).toContain(
        column
      );
      expect(
        migrated.columns,
        `migrated database is missing ${column}`
      ).toContain(column);
    }
  });

  // The deployed table has rows. Migrating must not drop them, and tone has to
  // land on its default rather than null against a NOT NULL column.
  it("keeps existing rows and defaults their tone", async () => {
    const migrated = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    expect(migrated.seededTone).toBe("news");
  });

  it("is safe to run twice", async () => {
    const once = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    const client = await pool.connect();
    let twice: string[];

    try {
      await client.query("DROP SCHEMA IF EXISTS drift_legacy CASCADE");
      await client.query("CREATE SCHEMA drift_legacy");
      await client.query("SET search_path TO drift_legacy");
      await client.query(LEGACY_STORIES);
      await client.query(schemaSql);
      await client.query(schemaSql);

      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'drift_legacy' AND table_name = 'stories'
          ORDER BY column_name`
      );
      twice = rows.map((row) => row.column_name);
    } finally {
      await client.query("DROP SCHEMA IF EXISTS drift_legacy CASCADE");
      client.release();
    }

    expect(twice).toEqual(once.columns);
  });
});
