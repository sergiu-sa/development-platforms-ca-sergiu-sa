/**
 * Applies db/schema.sql to one named database, and reports what changed.
 *
 * Nothing on this project applies the schema on its own, so a column reaches a database only when a person puts it there.
 * Three databases now need that done separately. db/README.md explains why, and what forgetting once cost.
 *
 * Usage:
 *
 *   vercel env pull .env.preview --environment=preview
 *   npm run db:apply -- .env.preview
 *
 *   npm run db:apply -- .env                 # local development database
 *   npm run db:apply -- --url postgres://…   # if you already have the address
 *
 * Reading the address out of a file is the recommended route: it keeps a password out of your shell history.
 *
 * The file is safe to apply repeatedly - tests/schema-drift.test.ts proves that - so the honest answer to "did that work?" is always to run it again.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { sslForConnection } from "../src/db/ssl.js";
import { checkSchema } from "../src/db/schema-probe.js";
import { SCHEMA_PROBES } from "../src/db/probes.js";

export interface Target {
  url: string;
  /** Where the address came from, for the printed summary. */
  source: string;
}

/**
 * Works out which database to apply to.
 *
 * There is deliberately no default. Falling back to DATABASE_URL would mean a  mistyped argument silently re-applies to whatever .env points at - almost always your laptop - while printing every appearance of success.
 * Believing you have updated a remote database when you have not is the exact failure this script exists to prevent, so it refuses rather than guesses.
 */
export function resolveTarget(
  args: string[],
  readEnvFile: (path: string) => string = (path) => readFileSync(path, "utf8")
): Target {
  const flagAt = args.indexOf("--url");

  if (flagAt !== -1) {
    const url = args[flagAt + 1];

    if (!url) {
      throw new Error("--url was given with no address after it.");
    }

    return { url, source: "--url" };
  }

  const path = args.find((arg) => !arg.startsWith("--"));

  if (!path) {
    throw new Error(
      "No target database given.\n" +
        "  npm run db:apply -- .env.preview\n" +
        "  npm run db:apply -- --url postgres://…\n" +
        "There is no default on purpose: the mistake worth guarding against " +
        "is re-applying to your local database while believing you reached Neon."
    );
  }

  const url = dotenv.parse(readEnvFile(path)).DATABASE_URL;

  if (!url) {
    throw new Error(`${path} does not set DATABASE_URL.`);
  }

  return { url, source: path };
}

/**
 * A database address with the password blanked out, safe to print.
 *
 * Everything this script logs goes through here. The same rule already applies to the Guardian key, which must never appear in a thrown message or a log line;
 * a database password is a stronger version of the same problem, and a script whose entire job is to talk about which database it reached will print one by accident otherwise.
 *
 * A password can arrive in two places, and only one of them is obvious.
 * `postgres://user:pw@host/db` puts it where the URL parser reports it, but `postgres://user@host/db?password=pw` is an equally valid connection string that pg reads out of the query and the URL parser reports as no password at all.
 * Blanking only the first would print the second in full.
 */
const SECRET_PARAMS = ["password", "sslpassword"];

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.password) {
      parsed.password = "REDACTED";
    }

    for (const name of SECRET_PARAMS) {
      if (parsed.searchParams.has(name)) {
        parsed.searchParams.set(name, "REDACTED");
      }
    }

    return parsed.toString();
  } catch {
    return "(unreadable database address)";
  }
}

/**
 * Every table and column currently present, so before and after can be compared.
 *
 * Reported per table rather than for `stories` alone.
 * The first version counted stories columns and nothing else, so the run that created the whole saved_stories table printed "added nothing, this database was already up to date";
 * which is the one sentence an operator must be able to trust, since it is the only feedback the step gives.
 */
async function schemaShape(runner: pg.Pool): Promise<Map<string, string[]>> {
  const { rows } = await runner.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, column_name`
  );

  const shape = new Map<string, string[]>();
  for (const row of rows) {
    const columns = shape.get(row.table_name) ?? [];
    columns.push(row.column_name);
    shape.set(row.table_name, columns);
  }

  return shape;
}

/** What the apply changed, as lines to print. */
export function describeChanges(
  before: Map<string, string[]>,
  after: Map<string, string[]>
): string[] {
  const lines: string[] = [];

  for (const [table, columns] of after) {
    if (!before.has(table)) {
      lines.push(`created ${table} (${columns.length} columns)`);
      continue;
    }

    const added = columns.filter(
      (column) => !(before.get(table) ?? []).includes(column)
    );

    if (added.length > 0) {
      lines.push(`altered ${table}: added ${added.join(", ")}`);
    }
  }

  return lines;
}

async function main(): Promise<void> {
  const target = resolveTarget(process.argv.slice(2));
  const schemaSql = readFileSync("db/schema.sql", "utf8");

  const pool = new pg.Pool({
    connectionString: target.url,
    ssl: sslForConnection(target.url),
    max: 1,
    connectionTimeoutMillis: 15000,
  });

  console.log("Applying db/schema.sql");
  console.log(`  from    ${target.source}`);
  console.log(`  to      ${redactUrl(target.url)}`);

  try {
    const before = await schemaShape(pool);
    await pool.query(schemaSql);
    const after = await schemaShape(pool);

    const changes = describeChanges(before, after);

    console.log(`  tables  ${after.size}`);

    if (changes.length === 0) {
      console.log("  changed nothing, this database was already up to date");
    } else {
      for (const line of changes) console.log(`  ${line}`);
    }

    // The same probe /api/health runs, so "the script succeeded" and "the endpoints will work" are the same claim rather than two hopeful ones.
    const check = await checkSchema(pool, SCHEMA_PROBES);

    if (!check.ok) {
      throw new Error(
        `Schema applied, but the database is still the wrong shape: ${check.detail}`
      );
    }

    console.log(
      `  checked every column all ${SCHEMA_PROBES.length} of its tables need`
    );
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so the tests can import the helpers above without the script connecting to anything.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
