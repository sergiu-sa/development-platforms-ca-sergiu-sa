/**
 * The guards over the guards.
 *
 * Two hand-kept lists decide whether this project's most expensive class of mistake gets caught:
 * `SCHEMA_PROBES`, which is what /api/health asks a database about, and `TRACKED_TABLES`, which is what the drift test compares down both apply paths.
 * A table missing from either is a table whose first added column reaches production silently
 *  - the phase 1 outage, which ran for three days.
 *
 * Neither list is trusted here.
 * `db/schema.sql` is applied to a real database and Postgres is asked what it built.
 *
 * The first version of this file read the schema file with a regex instead.
 * That was the wrong altitude and its failure mode was silence:
 *  a table declared without `IF NOT EXISTS`, or written as `public.stories`, was simply invisible, and an invisible table is one nothing demands a probe for.
 * It also found a table called `leaves`, from the sentence "CREATE TABLE IF NOT EXISTS leaves an existing table untouched" in a comment.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pool } from "../src/db/connection.js";
import { checkSchema } from "../src/db/schema-probe.js";
import { SCHEMA_PROBES } from "../src/db/probes.js";
import { BRIEFING_FIELDS } from "../src/modules/briefings/briefings.service.js";
import { BRIEFINGS_PROBE } from "../src/modules/briefings/briefings.columns.js";
import { createSchema, closeDatabase } from "./helpers/db.js";
import { TRACKED_TABLES, inThrowawaySchema } from "./helpers/schema-sandbox.js";

beforeAll(createSchema);
afterAll(closeDatabase);

/** What db/schema.sql actually creates, according to Postgres. */
async function tablesInSchema(): Promise<string[]> {
  return inThrowawaySchema("probe_tables", async (client) => {
    await client.query(readFileSync("db/schema.sql", "utf8"));

    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'probe_tables' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
    );

    return rows.map((row) => row.table_name);
  });
}

describe("every table db/schema.sql creates is guarded", () => {
  // A check that finds nothing sweeps nothing and passes, which is worse than the stale list it replaced.
  // Phase 7 learned this in contrast.test.ts.
  it("finds the tables at all", async () => {
    const tables = await tablesInSchema();

    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toContain("stories");
    expect(tables).toContain("briefing_items");
  });

  it("has a health probe for each of them", async () => {
    const probed = SCHEMA_PROBES.map((probe) => probe.table);
    const unprobed = (await tablesInSchema()).filter(
      (table) => !probed.includes(table)
    );

    expect(
      unprobed,
      "These tables are created by db/schema.sql but nothing in " +
        "src/db/probes.ts asks a database whether it has them, so " +
        "/api/health would report a deployment missing one as healthy:\n  " +
        unprobed.join("\n  ")
    ).toEqual([]);
  });

  it("has drift tracking for each of them", async () => {
    const untracked = (await tablesInSchema()).filter(
      (table) => !TRACKED_TABLES.includes(table as never)
    );

    expect(
      untracked,
      "These tables are not in TRACKED_TABLES, so the first column added to " +
        "one of them with no matching ALTER TABLE will pass CI and be absent " +
        "in production:\n  " +
        untracked.join("\n  ")
    ).toEqual([]);
  });

  it("names no table db/schema.sql does not create", async () => {
    const tables = await tablesInSchema();
    const stray = [
      ...SCHEMA_PROBES.map((probe) => probe.table),
      ...TRACKED_TABLES,
    ].filter((table) => !tables.includes(table));

    expect(stray).toEqual([]);
  });

  // The lists being complete says nothing about their being true.
  it("passes in full against a database built from db/schema.sql", async () => {
    const check = await checkSchema(pool, SCHEMA_PROBES);

    expect(check.ok, check.detail).toBe(true);
  });
});

// The wire derives its SELECT list from the same constant it probes, so the two cannot disagree.
// The briefings query is written out by hand instead, because it deliberately omits author_id
//  - deriving it would publish every column added later.
// That leaves a gap this closes:
// a column selected but not probed makes /api/health call a database healthy that cannot serve the listing, which is the probe's own blind spot.
describe("the briefings probe covers what the briefings query selects", () => {
  const selected = [...BRIEFING_FIELDS.matchAll(/briefing\.(\w+)/g)].map(
    (match) => match[1]
  );

  it("finds the selected columns at all", () => {
    expect(selected).toContain("slug");
    expect(selected.length).toBeGreaterThan(5);
  });

  it("probes every column the query names", () => {
    const unprobed = selected.filter(
      (column) => !BRIEFINGS_PROBE.columns.includes(column)
    );

    expect(
      unprobed,
      "BRIEFING_FIELDS selects these, but BRIEFING_COLUMNS does not list " +
        "them, so /api/health cannot see them missing:\n  " +
        unprobed.join("\n  ")
    ).toEqual([]);
  });
});

/**
 * The invariant that lets `npm run db:apply -- .env.production` work at all.
 *
 * src/db/connection.ts builds a pool from `.env` the moment it is imported.
 * The apply script reads SCHEMA_PROBES while pointed at a *different* database, so  anything reachable from that import must never pull the pool in.
 * One ordinary `import { pool }` added to a columns file would make the script connect to whatever `.env` says before it has decided anything
 * - the exact failure its "refuse to run without an explicit target" design exists to prevent, arriving by the back door with every sign of success printed.
 *
 * Stated in prose in six files and, until now, enforced nowhere.
 */
describe("the probe list stays importable without a database", () => {
  /** Every module a file reaches at runtime, following relative imports. */
  function runtimeImports(
    entry: string,
    seen = new Set<string>()
  ): Set<string> {
    if (seen.has(entry)) {
      return seen;
    }

    seen.add(entry);

    const source = readFileSync(entry, "utf8");
    // `import type` is erased by the compiler, so it cannot drag anything in.
    const imports = [
      ...source.matchAll(/import\s+([\s\S]*?)from\s+"(\.[^"]+)"/g),
    ]
      .filter((match) => !/^\s*type\s/.test(match[1]))
      .map((match) => match[2]);

    for (const specifier of imports) {
      runtimeImports(
        resolve(dirname(entry), specifier.replace(/\.js$/, ".ts")),
        seen
      );
    }

    return seen;
  }

  it("reaches no module that builds a connection pool", () => {
    const reached = [...runtimeImports("src/db/probes.ts")];
    const offenders = reached.filter((file) => file.endsWith("connection.ts"));

    expect(
      offenders,
      "src/db/probes.ts now reaches src/db/connection.ts at runtime, which " +
        "builds a pool from .env on import. scripts/apply-schema.ts imports " +
        "this list while pointed at another database, so it would connect to " +
        "the wrong one before deciding anything. Use `import type`, or move " +
        "what you needed."
    ).toEqual([]);
  });

  // Proves the walker can see a runtime import at all
  //  - otherwise the case above passes for a file it never actually read.
  it("does find the pool when a module really imports it", () => {
    const reached = [
      ...runtimeImports("src/modules/briefings/briefings.service.ts"),
    ];

    expect(reached.some((file) => file.endsWith("connection.ts"))).toBe(true);
  });
});
