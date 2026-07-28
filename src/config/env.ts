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

// GUARDIAN_API_KEY is required rather than optional: the wire is the homepage,
// and the key is server-side only, so a missing key should fail loudly at
// startup rather than as an empty feed in production.
const requiredEnvVars = ["DATABASE_URL", "JWT_SECRET", "GUARDIAN_API_KEY"];

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

/**
 * Numeric env var with a fallback. Written out rather than using
 * `Number(x) || fallback` because that idiom silently rejects 0, and 0 is a
 * legitimate TTL in development ("always refresh").
 */
function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  allowedOrigins: parseAllowedOrigins(),
  isProduction: process.env.NODE_ENV === "production",
  guardianApiKey: process.env.GUARDIAN_API_KEY || "",
  // How long cached stories stay fresh before the next request refills them.
  wireTtlMinutes: numberFromEnv("WIRE_TTL_MINUTES", 15),
  // Floor on the gap between upstream attempts, successful or not. This is what
  // stops an outage from retrying on every request and draining the daily limit.
  wireRetryCooldownMinutes: numberFromEnv("WIRE_RETRY_COOLDOWN_MINUTES", 5),
};

/**
 * Database name from a Postgres connection URL. Backs the test-database safety
 * rail in tests/helpers/db.ts, which refuses to run against anything not ending
 * in "_test". Returns "" for an unparseable or missing URL so the guard fails
 * closed rather than open.
 */
export function databaseNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}
