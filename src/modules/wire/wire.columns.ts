/**
 * The stories columns the wire depends on, and a probe that asks a database
 * whether it actually has them.
 *
 * "The schema file is correct" and "this database has the schema" are
 * different claims, and only the first one is tested. Nothing here applies
 * db/schema.sql - see db/README.md for why, and for what it cost.
 *
 * Deliberately free of runtime imports. src/db/connection.ts builds a pool the
 * moment it loads, from whatever .env says, so a command-line script pointed
 * at a *different* database must be able to reach this code without dragging
 * that along. A type-only import is erased and does not count.
 */

import type pg from "pg";

/**
 * Every column the wire query selects, as an array so it can be compared
 * against a real database's column list. The SQL fragment below is derived
 * from it rather than written out again.
 */
export const STORY_COLUMNS = [
  "id",
  "title",
  "summary",
  "standfirst",
  "byline",
  "url",
  "section",
  "pillar",
  "tone",
  "word_count",
  "star_rating",
  "thumbnail_url",
  "image_url",
  "image_alt",
  "image_credit",
  "published_at",
] as const;

/**
 * Columns storeStories writes but the wire never selects.
 *
 * They belong in the probe even though no response carries them. A database
 * missing one accepts every read and fails every refresh, and refreshIfNeeded
 * swallows refresh failures by design - so the symptom would be a wire that
 * quietly stops updating, with nothing in the logs and a health check saying
 * everything is fine. That is the phase 1 failure wearing a different hat.
 */
const WRITE_ONLY_COLUMNS = ["external_id", "fetched_at"] as const;

/**
 * The columns as a SELECT list.
 *
 * This gets interpolated into SQL, which is forbidden everywhere else in this
 * codebase. It is safe here and only here because it is a fixed list defined
 * in this file with no input of any kind reaching it. The rule it appears to
 * break is about *values*, and values still travel as $1 placeholders.
 */
export const WIRE_STORY_COLUMNS = STORY_COLUMNS.join(", ");

const PROBED_COLUMNS = [...STORY_COLUMNS, ...WRITE_ONLY_COLUMNS].join(", ");

/** Anything that can run SQL: a pool, or a client pinned to one schema. */
export type Queryable = Pick<pg.PoolClient, "query">;

export interface WireSchemaCheck {
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
 * Asks Postgres whether stories has every column the wire depends on.
 *
 * LIMIT 0 returns no rows, but column names are resolved when the query is
 * planned rather than when it runs, so a missing one still raises 42703.
 * Measured on a 300k-row table: the Limit node short-circuits and the scan is
 * never executed, so this reads zero heap buffers and costs only planning.
 * That is what makes it cheap enough to sit on a health endpoint.
 *
 * It doubles as the connection check. A query cannot run without a
 * connection, so an unreachable database throws here too - with a Node error
 * code rather than a SQLSTATE, which is how the caller tells them apart.
 */
export async function checkWireSchema(
  runner: Queryable
): Promise<WireSchemaCheck> {
  try {
    await runner.query(`SELECT ${PROBED_COLUMNS} FROM stories LIMIT 0`);
    return { ok: true };
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };

    // Only the two schema codes are passed through verbatim. Both name a
    // table or column that db/schema.sql already publishes, so they leak
    // nothing, and saying which column is missing is the entire value of this
    // check. Anything else stays generic, matching how the rest of the API
    // reports errors, and travels back as `cause` for the caller to log.
    return {
      ok: false,
      code,
      detail: isSchemaError(code)
        ? (message ?? "The stories table is not the shape the wire expects.")
        : "The database could not be reached.",
      cause: error,
    };
  }
}
