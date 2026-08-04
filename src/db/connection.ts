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
