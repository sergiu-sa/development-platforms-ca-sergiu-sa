/**
 * Test database helpers.
 *
 * Tests run against a real MySQL database rather than mocks, so they exercise
 * the actual SQL. That makes the reset logic destructive, hence the guard below.
 */

import { pool } from "../../src/db/connection.js";
import { config } from "../../src/config/env.js";

// Safety rail: resetDatabase() truncates every table, so refuse outright to
// point at anything that is not explicitly a test database. Without this, a
// missing .env.test would silently fall through to the development database
// and wipe it.
const databaseName = config.db.database;

if (!databaseName.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests against database "${databaseName}". ` +
      `The test database name must end with "_test". ` +
      `Copy .env.test.example to .env.test and set MYSQLDATABASE=news_api_test.`
  );
}

/** Creates the schema. Mirrors database-schema.sql minus the seed data. */
export async function createSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      category VARCHAR(100) NOT NULL,
      submitted_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

/** Empties every table so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  await pool.query("TRUNCATE TABLE articles");
  await pool.query("TRUNCATE TABLE users");
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
