/**
 * Database Connection Module
 * Postgres connection pool. Reads its configuration from config/env.ts.
 */

import pg from "pg";
import { config } from "../config/env.js";

const { Pool } = pg;

/**
 * Local Postgres runs without TLS; hosted Postgres (Neon) requires it.
 * Deciding from the URL keeps one code path working in both places.
 *
 * Parses the hostname rather than pattern-matching the whole string, so a
 * password containing "@" or "localhost" cannot flip the decision. Fails
 * closed to TLS on an unparseable URL.
 */
function sslSetting(): pg.PoolConfig["ssl"] {
  const localHosts = ["localhost", "127.0.0.1", "::1"];

  try {
    const { hostname } = new URL(config.databaseUrl);
    return localHosts.includes(hostname) ? false : { rejectUnauthorized: true };
  } catch {
    return { rejectUnauthorized: true };
  }
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslSetting(),
  max: config.databasePoolMax,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

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
