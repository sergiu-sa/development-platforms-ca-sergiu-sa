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

/**
 * Validates all required environment variables are set.
 *
 * Throws rather than calling process.exit, because this also runs inside a
 * serverless function where exiting kills the invocation without leaving a
 * usable log line. src/index.ts catches it and exits for local use, and
 * api/index.ts lets it surface as a 500 with the reason in Vercel's logs.
 */
export function validateEnv(): void {
  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Locally, copy .env.example to .env and fill in the missing values. ` +
        `On a hosted deployment, set them in the project's environment settings.`
    );
  }
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
  // Set by `npm run dev:api` only. When present, Vite is running alongside this
  // process and owns the frontend, so this server must not also serve the last
  // build from dist/web - see the redirect in src/index.ts for why that
  // combination is actively harmful rather than merely redundant.
  webDevServer: process.env.WEB_DEV_SERVER || "",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  allowedOrigins: parseAllowedOrigins(),
  isProduction: process.env.NODE_ENV === "production",
  // Vercel sets VERCEL=1. Every warm serverless instance keeps its own
  // connection pool, so a pool of 10 per instance exhausts the database's
  // connection limit quickly; one is enough when an instance handles a single
  // request at a time.
  databasePoolMax: numberFromEnv(
    "DATABASE_POOL_MAX",
    process.env.VERCEL === "1" ? 1 : 10
  ),
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
