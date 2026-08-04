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
import { checkWireSchema } from "../src/modules/wire/wire.columns.js";

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

/** The columns stories currently has, so before and after can be compared. */
async function storyColumns(runner: pg.Pool): Promise<string[]> {
  const { rows } = await runner.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'stories' AND table_schema = current_schema()
      ORDER BY column_name`
  );

  return rows.map((row) => row.column_name);
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
    const before = await storyColumns(pool);
    await pool.query(schemaSql);
    const after = await storyColumns(pool);

    const added = after.filter((column) => !before.includes(column));

    console.log(`  stories ${after.length} columns`);
    console.log(
      added.length > 0
        ? `  added   ${added.join(", ")}`
        : "  added   nothing, this database was already up to date"
    );

    // The same probe /api/health runs, so "the script succeeded" and "the endpoint will work" are the same claim rather than two hopeful ones.
    const check = await checkWireSchema(pool);

    if (!check.ok) {
      throw new Error(
        `Schema applied, but /api/wire still cannot read stories: ${check.detail}`
      );
    }

    console.log("  wire    every column the wire depends on is present");
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so the tests can import the helpers above
// without the script connecting to anything.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
