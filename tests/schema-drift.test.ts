/**
 * Schema drift tests.
 *
 * db/schema.sql declares the stories columns twice and both have to stay in step:
 *
 *   - CREATE TABLE IF NOT EXISTS builds fresh installs and the test database
 *   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS migrates a database that already holds stories, because CREATE TABLE IF NOT EXISTS leaves an existing table completely untouched
 *
 * The duplication is deliberate, but it is the same shape as the CSP being declared in two files, and it fails the same way:
 * add a column to the CREATE TABLE block alone and it appears locally and in CI
 *  - where the table is always built from scratch
 *  - while being silently absent in production, which is the only place the ALTER path runs.
 *
 * So rather than compare the two declarations as text, these apply the real file down both paths and assert they converge.
 * Each runs inside its own Postgres schema on one connection with search_path pointed at it, so the unqualified names in db/schema.sql resolve there and the real tables are never touched.
 */

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { TONE_PRECEDENCE } from "../src/modules/wire/wire.guardian.js";
import { STORY_COLUMNS } from "../src/modules/wire/wire.columns.js";
import { DECISIONS } from "../src/modules/desk/desk.schema.js";
import { BRIEFING_STATUSES } from "../src/modules/briefings/briefings.schema.js";
import { closeDatabase } from "./helpers/db.js";
import {
  DEPLOYED_AT_PHASE_8,
  DEPLOYED_AT_PHASE_8_COLUMNS,
  TRACKED_TABLES,
  inThrowawaySchema,
} from "./helpers/schema-sandbox.js";

const schemaSql = readFileSync("db/schema.sql", "utf8");

type TrackedTable = (typeof TRACKED_TABLES)[number];

/**
 * Enums whose labels are also written down in TypeScript.
 *
 * Each of these is a set that cannot be collapsed into one declaration, because one half lives in Postgres and the other in code.
 * The cases below are what stop the two halves drifting.
 */
const TRACKED_ENUMS = [
  "story_tone",
  "story_decision",
  "briefing_status",
] as const;

type TrackedEnum = (typeof TRACKED_ENUMS)[number];

interface AppliedSchema {
  /** Column names per tracked table, sorted. */
  columns: Record<TrackedTable, string[]>;
  /** Labels per tracked enum, sorted. */
  enumLabels: Record<TrackedEnum, string[]>;
  /** The tone of the row seeded before migrating, if one was seeded. */
  seededTone: string | null;
}

/**
 * Applies db/schema.sql inside a throwaway Postgres schema and reports the columns each tracked table ends up with.
 * `before` runs first, so a caller can stand up the old tables and exercise the migration path.
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

    const { rows } = await client.query<{
      table_name: TrackedTable;
      column_name: string;
    }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = ANY($2)
        ORDER BY table_name, column_name`,
      [name, [...TRACKED_TABLES]]
    );

    const columns = Object.fromEntries(
      TRACKED_TABLES.map((table) => [
        table,
        rows
          .filter((row) => row.table_name === table)
          .map((row) => row.column_name),
      ])
    ) as Record<TrackedTable, string[]>;

    // Sorted by label rather than by enum position:
    // the order Postgres storesthem in carries no meaning here, only which labels exist.
    const { rows: labels } = await client.query<{
      typname: TrackedEnum;
      enumlabel: string;
    }>(
      `SELECT t.typname, e.enumlabel
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = ANY($2) AND n.nspname = $1
        ORDER BY t.typname, e.enumlabel`,
      [name, [...TRACKED_ENUMS]]
    );

    const enumLabels = Object.fromEntries(
      TRACKED_ENUMS.map((type) => [
        type,
        labels
          .filter((row) => row.typname === type)
          .map((row) => row.enumlabel),
      ])
    ) as Record<TrackedEnum, string[]>;

    return { columns, enumLabels, seededTone };
  });
}

afterAll(closeDatabase);

describe("db/schema.sql applied to an existing database", () => {
  // One case per tracked table rather than one loop over both, so a failure names the table in its title instead of only in the diff.
  for (const table of TRACKED_TABLES) {
    it(`reaches the same ${table} columns as a fresh install`, async () => {
      const fresh = await applySchemaIn("drift_fresh");
      const migrated = await applySchemaIn("drift_legacy", DEPLOYED_AT_PHASE_8);

      const missing = fresh.columns[table].filter(
        (column) => !migrated.columns[table].includes(column)
      );

      expect(
        missing,
        `These ${table} columns are in the CREATE TABLE block but no ALTER ` +
          "TABLE adds them, so a database that already holds rows will never " +
          "get them:\n  " +
          missing.join("\n  ")
      ).toEqual([]);

      expect(migrated.columns[table]).toEqual(fresh.columns[table]);

      // Guards against both sides passing vacuously: a table that was never created would give two empty, equal lists.
      expect(fresh.columns[table].length).toBeGreaterThan(0);
    });
  }

  // The snapshot the whole convergence check rests on.
  // Editing it is the wrong way to silence a drift failure, because it disarms the guard permanently rather than fixing the schema
  //  - so an edit has to break something loud.
  it("keeps the deployed snapshot frozen", async () => {
    const migrated = await inThrowawaySchema("drift_frozen", async (client) => {
      await client.query(DEPLOYED_AT_PHASE_8);

      const { rows } = await client.query<{
        table_name: string;
        columns: string;
      }>(
        `SELECT table_name, count(*)::text AS columns
           FROM information_schema.columns
          WHERE table_schema = 'drift_frozen'
          GROUP BY table_name`
      );

      return Object.fromEntries(
        rows.map((row) => [row.table_name, Number(row.columns)])
      );
    });

    expect(
      migrated,
      "DEPLOYED_AT_PHASE_8 in tests/helpers/schema-sandbox.ts is a frozen " +
        "record of what production looked like when phase 8 shipped, and it " +
        "contains the phase 6 snapshot. If you changed either to make a drift " +
        "failure go away, that failure was real: write the ALTER TABLE instead."
    ).toEqual(DEPLOYED_AT_PHASE_8_COLUMNS);
  });

  // The deployed table has rows.
  // Migrating must not drop them, and tone has to land on its default rather than null against a NOT NULL column.
  it("keeps existing rows and defaults their tone", async () => {
    const migrated = await applySchemaIn("drift_legacy", DEPLOYED_AT_PHASE_8);

    expect(migrated.seededTone).toBe("news");
  });

  // The set of tones exists in two places that cannot be collapsed:
  // the enum here and TONE_PRECEDENCE in the Guardian client.
  // A tone in the code but not the enum makes the bulk upsert throw, and refreshIfNeeded() swallows refresh failures on purpose
  //  - so the wire would serve stale content indefinitely with nothing logged as the cause.
  it("declares exactly the tones the Guardian client resolves", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const fromCode = [...TONE_PRECEDENCE].sort();

    expect(
      fresh.enumLabels.story_tone,
      "The story_tone enum in db/schema.sql and TONE_PRECEDENCE in " +
        "src/modules/wire/wire.guardian.ts have drifted apart. Both must " +
        "list the same tones:\n" +
        `    schema.sql:  ${fresh.enumLabels.story_tone.join(", ")}\n` +
        `    wire client: ${fromCode.join(", ")}`
    ).toEqual(fromCode);
  });

  // The same pair, one table along. A decision the API accepts but the enum does not have makes every write of it fail
  //  - louder than the tone version, which fails inside a swallowed refresh, but just as avoidable.
  it("declares exactly the decisions the desk accepts", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const fromCode = [...DECISIONS].sort();

    expect(
      fresh.enumLabels.story_decision,
      "The story_decision enum in db/schema.sql and DECISIONS in " +
        "src/modules/desk/desk.schema.ts have drifted apart. Both must list " +
        "the same states:\n" +
        `    schema.sql:  ${fresh.enumLabels.story_decision.join(", ")}\n` +
        `    desk schema: ${fromCode.join(", ")}`
    ).toEqual(fromCode);
  });

  // The same pair again, two tables along. status decides whether a briefingis visible to anybody but its author, so a label the API accepts and the enum does not would fail every attempt to file one.
  it("declares exactly the statuses a briefing can hold", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const fromCode = [...BRIEFING_STATUSES].sort();

    expect(
      fresh.enumLabels.briefing_status,
      "The briefing_status enum in db/schema.sql and BRIEFING_STATUSES in " +
        "src/modules/briefings/briefings.schema.ts have drifted apart. Both " +
        "must list the same statuses:\n" +
        `    schema.sql:       ${fresh.enumLabels.briefing_status.join(", ")}\n` +
        `    briefings schema: ${fromCode.join(", ")}`
    ).toEqual(fromCode);
  });

  // The static half of the health check, and the guard that stops the first assertion passing vacuously
  //  - if stories were never created, both column lists would be empty and equal, but STORY_COLUMNS would not be a subset.
  //
  // /api/health asks a running database whether it has these columns;
  // this asks db/schema.sql whether it would ever produce them, down both the fresh and the migrated path.
  // A column added to the wire query but forgotten in the schema file fails here, at the cheapest possible moment, rather than as a 42703 in production.
  it("produces every column the wire query selects, down both paths", async () => {
    const fresh = await applySchemaIn("drift_fresh");
    const migrated = await applySchemaIn("drift_legacy", DEPLOYED_AT_PHASE_8);

    const missingFresh = STORY_COLUMNS.filter(
      (column) => !fresh.columns.stories.includes(column)
    );
    const missingMigrated = STORY_COLUMNS.filter(
      (column) => !migrated.columns.stories.includes(column)
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
    const once = await applySchemaIn("drift_legacy", DEPLOYED_AT_PHASE_8);

    const twice = await inThrowawaySchema("drift_legacy", async (client) => {
      await client.query(DEPLOYED_AT_PHASE_8);
      await client.query(schemaSql);
      await client.query(schemaSql);

      const { rows } = await client.query<{
        table_name: TrackedTable;
        column_name: string;
      }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'drift_legacy' AND table_name = ANY($1)
          ORDER BY table_name, column_name`,
        [[...TRACKED_TABLES]]
      );

      return rows;
    });

    for (const table of TRACKED_TABLES) {
      expect(
        twice
          .filter((row) => row.table_name === table)
          .map((row) => row.column_name)
      ).toEqual(once.columns[table]);
    }
  });
});
