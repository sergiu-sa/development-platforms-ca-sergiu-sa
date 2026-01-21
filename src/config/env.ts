import dotenv from "dotenv";

dotenv.config();

const requiredEnvVars = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "JWT_SECRET",
];

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
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME || "news_api",
  },

  jwtSecret: process.env.JWT_SECRET || "",

  isProduction: process.env.NODE_ENV === "production",
};
