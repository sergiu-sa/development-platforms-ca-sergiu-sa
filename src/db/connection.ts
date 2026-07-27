/**
 * Database Connection Module
 * MySQL connection pool with production-ready settings.
 */

import mysql from "mysql2/promise";
import { config } from "../config/env.js";

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// Test connection on startup
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    console.log("✅ Database connection successful!");
    connection.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed!");
    console.error("Error details:", error);
    console.error("\n📋 Troubleshooting checklist:");
    console.error("   1. Is MySQL running on your computer?");
    console.error("   2. Did you create a .env file from .env.example?");
    console.error("   3. Are your database credentials correct in .env?");
    console.error('   4. Did you create the "news_api" database?');
    console.error(
      "   5. Did you run the database-schema.sql file in MySQL Workbench?"
    );
    return false;
  }
}

export { pool };
