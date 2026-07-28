/**
 * News API - Main Server Entry Point
 *
 * Validates the environment, then starts the HTTP server. The app itself is
 * assembled in src/app.ts.
 */

import { serve } from "@hono/node-server";
import { validateEnv, config } from "./config/env.js";
import { testConnection } from "./db/connection.js";
import { app } from "./app.js";

validateEnv();

const PORT = config.port;

console.log("🚀 Starting News API server...");
console.log(`📍 Server will run on: http://localhost:${PORT}`);

testConnection().then((connected) => {
  if (!connected) {
    console.log("\n⚠️  Server starting without database connection.");
    console.log("   Fix database issues and restart the server.");
  }
});

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`✅ Server is running on http://localhost:${PORT}`);
console.log("\n📝 Available endpoints:");
console.log(
  `   GET  http://localhost:${PORT}/              - Home page (frontend)`
);
console.log(
  `   GET  http://localhost:${PORT}/api/health        - Database health check`
);
console.log(
  `   POST http://localhost:${PORT}/api/auth/register - Register new user`
);
console.log(`   POST http://localhost:${PORT}/api/auth/login    - Login user`);
console.log("\nPress Ctrl+C to stop the server.");
