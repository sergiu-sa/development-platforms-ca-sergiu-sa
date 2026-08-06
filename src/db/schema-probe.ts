/**
 * Asking a database whether it has the shape the application needs.
 *
 * "The schema file is correct" and "this database has the schema" are
 * different claims, and only the first one is tested. Nothing here applies
 * db/schema.sql - see db/README.md for why, and for what it cost.
 *
 * The mechanism lives here; the knowledge of which columns matter lives in the
 * module that depends on them, and the caller composes the two. Infrastructure
 * holding a feature's column list is what phase 5's review took out of
 * connection.ts, and it would come straight back if this file named tables.
 *
 * Deliberately free of runtime imports. src/db/connection.ts builds a pool the
 * moment it loads, from whatever .env says, so a command-line script pointed
 * at a *different* database must be able to reach this code without dragging
 * that along. A type-only import is erased and does not count.
 */

import type pg from "pg";

/** Anything that can run SQL: a pool, or a client pinned to one schema. */
export type Queryable = Pick<pg.PoolClient, "query">;

/** One table and the columns something depends on it having. */
export interface TableProbe {
  table: string;
  columns: readonly string[];
}

export interface SchemaCheck {
  ok: boolean;
  /**
   * Postgres SQLSTATE. 42703 is "column does not exist" - the schema is old.
   * 42P01 is "table does not exist" - it was never applied at all. Anything
   * else means the database could not be reached.
   */
  code?: string;
  /** Cause, safe to show a client. Absent when ok. */
  detail?: string;
  /** The original error, for logging only. Never send this to a client. */
  cause?: unknown;
}

/** True when the database answered and only its shape was wrong. */
export function isSchemaError(code: string | undefined): boolean {
  return code === "42703" || code === "42P01";
}

/**
 * Asks Postgres whether every probed table has every column named.
 *
 * LIMIT 0 returns no rows, but column names are resolved when the query is
 * planned rather than when it runs, so a missing one still raises 42703.
 * Measured on a 300k-row table: the Limit node short-circuits and the scan is
 * never executed, so this reads zero heap buffers and costs only planning.
 * That is what makes it cheap enough to sit on a health endpoint.
 *
 * All the probes travel as one semicolon-separated statement, which pg sends
 * through the simple query protocol in a single round trip. That matters more
 * than it looks: on Vercel each instance holds a pool of one connection, so
 * every extra round trip here doubles how long a polled public endpoint
 * occupies the connection real requests are queued behind.
 *
 * It doubles as the connection check. A query cannot run without a connection,
 * so an unreachable database throws here too - with a Node error code rather
 * than a SQLSTATE, which is how the caller tells them apart.
 *
 * The table and column names are interpolated. That is forbidden everywhere
 * else in this codebase and is safe here only because every probe is a fixed
 * literal declared in source with no input of any kind reaching it. The rule
 * it appears to break is about *values*, and there are no values in a probe.
 */
export async function checkSchema(
  runner: Queryable,
  probes: readonly TableProbe[]
): Promise<SchemaCheck> {
  const sql = probes
    .map(
      (probe) =>
        `SELECT ${probe.columns.join(", ")} FROM ${probe.table} LIMIT 0`
    )
    .join("; ");

  try {
    await runner.query(sql);
    return { ok: true };
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };

    // Only the two schema codes are passed through verbatim. Both name a
    // table or column that db/schema.sql already publishes, so they leak
    // nothing, and saying which one is missing is the entire value of this
    // check. Anything else stays generic, matching how the rest of the API
    // reports errors, and travels back as `cause` for the caller to log.
    return {
      ok: false,
      code,
      detail: isSchemaError(code)
        ? (message ?? "The database is not the shape this application expects.")
        : "The database could not be reached.",
      cause: error,
    };
  }
}
