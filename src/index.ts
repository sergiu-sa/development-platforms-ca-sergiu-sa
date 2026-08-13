/**
 * Local development entry point.
 *
 * Validates the environment, wraps the API in a server that also serves the frontend, and listens.
 * Vercel never runs this file - it calls api/index.tsinstead, and serves dist/web from its CDN.
 * That split is why static file serving lives here rather than in app.ts.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { validateEnv, config } from "./config/env.js";
import { testConnection } from "./db/connection.js";
import { app } from "./app.js";

// validateEnv throws so the same check can run in a serverless function.
// Here, a missing variable should stop the process outright rather than start a server that cannot reach its database.
try {
  validateEnv();
  console.log("✅ Environment variables validated");
} catch (error) {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
}

const PORT = config.port;

const server = new Hono();

// Local development only: never let the browser store these responses.
//
// Without a Cache-Control header the browser decides for itself, and Chrome keeps the whole rendered page in its back/forward cache.
// Two symptoms followed, both of which cost real debugging time:
//
//   1. Stopping the server and reloading restored a ghost copy of the page rather than an honest error. Measured: navigation type "back_forward", zero bytes transferred, no requests made. The site looked alive while nothing was running.
//   2. Editing a file in web/ kept serving the previous build until a hard reload, which surfaces as a baffling "does not provide an export   named X" when a stale       ES module meets a fresh one.
//
// Production is unaffected: Vercel's CDN sets its own caching headers and
// never runs this file.
server.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

server.route("/", app);

if (config.webDevServer) {
  // `npm run dev` starts Vite next to this process, and Vite owns the frontend.
  // Serving dist/web from here as well is worse than useless: this port answers 200 with the last *build*, which can be hours old, while Vite serves the real thing on another port.
  // That happened - port 3000 was serving a sixteen-hour-old page that looked entirely plausible.
  // Redirect instead, so there is exactly one URL showing the current frontend.
  server.get("*", (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound();

    // Carry the query string across. c.req.path drops it, which silently broke the one flow most likely to send you here: /login.html?expired=1&next=/x arrived as /login.html with both parameters gone.
    const { search } = new URL(c.req.url);
    return c.redirect(`${config.webDevServer}${c.req.path}${search}`, 302);
  });
} else {
  // `npm start`: no Vite, so this process serves the build it was given.
  //
  // /b/:slug needs nothing here: `app` owns that path directly and is mounted above, before serveStatic gets a chance to look for a file called b/<slug>.
  // This used to re-dispatch the pretty path to the API one by hand, which worked locally and hid the fact that the deployed router never saw the rewritten path at all.
  // serveStatic is registered after the API so it cannot shadow it, and the explicit "/" handler stays last because serveStatic calls next() when it finds no file;
  //  that is what lets the index page resolve.
  server.use("/*", serveStatic({ root: "./dist/web" }));
  server.get("/", serveStatic({ path: "./dist/web/index.html" }));
}

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
if (config.webDevServer) {
  console.log(`   ⚠️  The frontend is NOT on this port in development.`);
  console.log(`   👉 Open ${config.webDevServer} - Vite serves it with HMR.`);
  console.log(`      http://localhost:${PORT}/ redirects there.`);
} else {
  console.log(
    `   GET  http://localhost:${PORT}/              - Home page (built frontend)`
  );
}
console.log(
  `   GET  http://localhost:${PORT}/api/health        - Database health check`
);
console.log(
  `   POST http://localhost:${PORT}/api/auth/register - Register new user`
);
console.log(`   POST http://localhost:${PORT}/api/auth/login    - Login user`);
console.log(`   GET  http://localhost:${PORT}/api/wire          - Story wire`);
console.log("\nPress Ctrl+C to stop the server.");
