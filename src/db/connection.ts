/**
 * Database Connection Module
 * MySQL connection pool with production-ready settings.
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || "localhost",
  port: Number(process.env.MYSQLPORT) || 3306,
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "news_api",
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
