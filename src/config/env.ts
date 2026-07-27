/**
 * Environment Variable Validation
 * Validates required env vars at startup and exports typed config.
 */

import dotenv from "dotenv";

// Vitest sets NODE_ENV=test, which routes us at a throwaway database instead of
// the development one. See tests/helpers/db.ts for the guard that enforces this.
dotenv.config({
  path: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
});

const requiredEnvVars = [
  "MYSQLHOST",
  "MYSQLUSER",
  "MYSQLPASSWORD",
  "MYSQLDATABASE",
  "JWT_SECRET",
];

// Validates all required environment variables are set
export function validateEnv(): void {
  const missing: string[] = [];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    console.error("");
    for (const envVar of missing) {
      console.error(`   - ${envVar}`);
    }
    console.error("");
    console.error("📋 How to fix:");
    console.error("   1. Copy .env.example to .env");
    console.error("   2. Fill in the missing values");
    console.error("   3. Restart the server");
    console.error("");
    process.exit(1);
  }

  console.log("✅ Environment variables validated");
}

// Comma-separated list of extra origins allowed to call the API from a browser.
// Left empty by default: the frontend is served from this same origin, which
// needs no CORS headers at all. Only set this if a separately hosted frontend
// needs access.
function parseAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.MYSQLHOST || "localhost",
    port: Number(process.env.MYSQLPORT) || 3306,
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "",
    database: process.env.MYSQLDATABASE || "news_api",
  },
  jwtSecret: process.env.JWT_SECRET || "",
  allowedOrigins: parseAllowedOrigins(),
  isProduction: process.env.NODE_ENV === "production",
};
