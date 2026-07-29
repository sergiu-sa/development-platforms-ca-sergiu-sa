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

// Local development only: never let the browser store these responses.
//
// Without a Cache-Control header the browser decides for itself, and Chrome
// keeps the whole rendered page in its back/forward cache. Two symptoms
// followed, both of which cost real debugging time:
//
//   1. Stopping the server and reloading restored a ghost copy of the page
//      rather than an honest error. Measured: navigation type "back_forward",
//      zero bytes transferred, no requests made. The site looked alive while
//      nothing was running.
//   2. Editing a file in public/ kept serving the previous version until a
//      hard reload, which surfaces as a baffling "does not provide an export
//      named X" when a stale ES module meets a fresh one.
//
// Production is unaffected: Vercel's CDN sets its own caching headers and
// never runs this file.
server.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

server.route("/", app);
server.use("/*", serveStatic({ root: "./dist/web" }));
server.get("/", serveStatic({ path: "./dist/web/index.html" }));

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
