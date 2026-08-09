/**
 * Database Connection Module
 * Postgres connection pool. Reads its configuration from config/env.ts.
 */

import pg from "pg";
import { config } from "../config/env.js";
import { sslForConnection } from "./ssl.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslForConnection(config.databaseUrl),
  max: config.databasePoolMax,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

/**
 * Runs `body` inside one transaction on one connection.
 *
 * Two things in the briefings module need this and neither works on the pool:
 * `SET CONSTRAINTS ... DEFERRED` only applies to the transaction that issues it, and `SELECT ... FOR UPDATE` only holds its lock until the transaction ends.
 * pool.query() takes an arbitrary connection per call, so both would be silently ineffective rather than failing.
 *
 * A failed ROLLBACK is swallowed deliberately.
 * It means the connection is already gone, and letting that error replace the one that caused it would hide the actual failure behind a symptom of it.
 */
export async function withTransaction<T>(
  body: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let released = false;

  try {
    await client.query("BEGIN");
    const result = await body(client);
    await client.query("COMMIT");

    return result;
  } catch (error) {
    // A failed ROLLBACK means the connection is already gone, and letting that error replace the one that caused it would hide the actual failure behind a symptom of it.
    // But the client cannot go back into the pool clean:
    // it may still be sitting in an aborted transaction, and the next borrower would get 25P02 on an unrelated request.
    // Releasing with an error destroys it instead.
    let broken = false;
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    client.release(broken ? (error as Error) : undefined);
    released = true;

    throw error;
  } finally {
    if (!released) {
      client.release();
    }
  }
}

// Test connection on startup
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    console.log("✅ Database connection successful!");
    client.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed!");
    console.error("Error details:", error);
    console.error("\n📋 Troubleshooting checklist:");
    console.error("   1. Is Postgres running? (brew services list)");
    console.error("   2. Did you create a .env file from .env.example?");
    console.error("   3. Is DATABASE_URL correct?");
    console.error('   4. Did you create the "news_api" database? (createdb)');
    console.error("   5. Did you run db/schema.sql against it?");
    return false;
  }
}

export { pool };
