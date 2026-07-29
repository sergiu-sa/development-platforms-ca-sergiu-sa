/**
 * Local development entry point.
 *
 * Validates the environment, wraps the API in a server that also serves the
 * frontend, and listens. Vercel never runs this file - it calls api/index.ts
 * instead, and serves public/ from its CDN. That split is why static file
 * serving lives here rather than in app.ts.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { validateEnv, config } from "./config/env.js";
import { testConnection } from "./db/connection.js";
import { app } from "./app.js";

// validateEnv throws so the same check can run in a serverless function. Here,
// a missing variable should stop the process outright rather than start a
// server that cannot reach its database.
try {
  validateEnv();
  console.log("✅ Environment variables validated");
} catch (error) {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
}

const PORT = config.port;

// One process serves both halves locally. serveStatic is registered after the
// API so it cannot shadow it, and the explicit "/" handler stays last because
// serveStatic calls next() when it finds no file - that is what lets the index
// page resolve.
const server = new Hono();

server.route("/", app);
server.use("/*", serveStatic({ root: "./public" }));
server.get("/", serveStatic({ path: "./public/index.html" }));

console.log("🚀 Starting News API server...");
console.log(`📍 Server will run on: http://localhost:${PORT}`);

testConnection().then((connected) => {
  if (!connected) {
    console.log("\n⚠️  Server starting without database connection.");
    console.log("   Fix database issues and restart the server.");
  }
});

serve({
  fetch: server.fetch,
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
console.log(`   GET  http://localhost:${PORT}/api/wire          - Story wire`);
console.log("\nPress Ctrl+C to stop the server.");
