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
import { TONE_PRECEDENCE } from "../src/modules/wire/wire.guardian.js";
import { STORY_COLUMNS } from "../src/modules/wire/wire.columns.js";
import { closeDatabase } from "./helpers/db.js";
import { LEGACY_STORIES, inThrowawaySchema } from "./helpers/schema-sandbox.js";

const schemaSql = readFileSync("db/schema.sql", "utf8");

interface AppliedSchema {
  columns: string[];
  /** The labels of the story_tone enum, sorted. */
  toneLabels: string[];
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
  return inThrowawaySchema(name, async (client) => {
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

    // Sorted by label rather than by enum position: the order Postgres stores
    // them in carries no meaning here, only which labels exist.
    const { rows: tones } = await client.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'story_tone' AND n.nspname = $1
        ORDER BY e.enumlabel`,
      [name]
    );

    return {
      columns: rows.map((row) => row.column_name),
      toneLabels: tones.map((row) => row.enumlabel),
      seededTone,
    };
  });
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

  // The deployed table has rows. Migrating must not drop them, and tone has to
  // land on its default rather than null against a NOT NULL column.
  it("keeps existing rows and defaults their tone", async () => {
    const migrated = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    expect(migrated.seededTone).toBe("news");
  });

  // The set of tones exists in two places that cannot be collapsed: the enum
  // here and TONE_PRECEDENCE in the Guardian client. A tone in the code but not
  // the enum makes the bulk upsert throw, and refreshIfNeeded() swallows
  // refresh failures on purpose - so the wire would serve stale content
  // indefinitely with nothing logged as the cause.
  it("declares exactly the tones the Guardian client resolves", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const fromCode = [...TONE_PRECEDENCE].sort();

    expect(
      fresh.toneLabels,
      "The story_tone enum in db/schema.sql and TONE_PRECEDENCE in " +
        "src/modules/wire/wire.guardian.ts have drifted apart. Both must " +
        "list the same tones:\n" +
        `    schema.sql:  ${fresh.toneLabels.join(", ")}\n` +
        `    wire client: ${fromCode.join(", ")}`
    ).toEqual(fromCode);
  });

  // The static half of the health check, and the guard that stops the first
  // assertion passing vacuously - if stories were never created, both column
  // lists would be empty and equal, but STORY_COLUMNS would not be a subset.
  //
  // /api/health asks a running database whether it has these columns; this
  // asks db/schema.sql whether it would ever produce them, down both the fresh
  // and the migrated path. A column added to the wire query but forgotten in
  // the schema file fails here, at the cheapest possible moment, rather than
  // as a 42703 in production.
  it("produces every column the wire query selects, down both paths", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const migrated = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    const missingFresh = STORY_COLUMNS.filter(
      (column) => !fresh.columns.includes(column)
    );
    const missingMigrated = STORY_COLUMNS.filter(
      (column) => !migrated.columns.includes(column)
    );

    expect(
      missingFresh,
      "STORY_COLUMNS lists columns a fresh install never creates:\n  " +
        missingFresh.join("\n  ")
    ).toEqual([]);

    expect(
      missingMigrated,
      "STORY_COLUMNS lists columns that no ALTER TABLE adds, so a database " +
        "that already holds stories will never get them:\n  " +
        missingMigrated.join("\n  ")
    ).toEqual([]);
  });

  it("is safe to run twice", async () => {
    const once = await applySchemaIn("drift_legacy", LEGACY_STORIES);

    const twice = await inThrowawaySchema("drift_legacy", async (client) => {
      await client.query(LEGACY_STORIES);
      await client.query(schemaSql);
      await client.query(schemaSql);

      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'drift_legacy' AND table_name = 'stories'
          ORDER BY column_name`
      );

      return rows.map((row) => row.column_name);
    });

    expect(twice).toEqual(once.columns);
  });
});
