/**
 * Environment Variable Validation
 * Validates required env vars at startup and exports typed config.
 */

import dotenv from "dotenv";

dotenv.config();

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
  isProduction: process.env.NODE_ENV === "production",
};
