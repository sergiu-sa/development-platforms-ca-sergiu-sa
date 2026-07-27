/**
 * News API - Application Wiring
 *
 * Builds the Hono app without starting a server, so tests can drive it through
 * app.fetch() directly. src/index.ts is the entry point that actually listens.
 */

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { config } from "./config/env.js";
import { pool } from "./db/connection.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { articleRoutes } from "./modules/articles/articles.route.js";

const app = new Hono();

// CORS - only for the API routes, and only for origins we explicitly name.
// The bundled frontend is same-origin, so it needs no CORS headers; this exists
// purely for a separately hosted frontend. No ALLOWED_ORIGINS means no CORS.
// Bare paths are listed alongside the wildcards because "/articles/*" does not
// match "/articles" itself.
if (config.allowedOrigins.length > 0) {
  const corsMiddleware = cors({ origin: config.allowedOrigins });
  const apiPaths = ["/auth", "/auth/*", "/articles", "/articles/*"];

  for (const path of apiPaths) {
    app.use(path, corsMiddleware);
  }
}

// Health check endpoint for monitoring
app.get("/health", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return c.json(
      {
        status: "unhealthy",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      503
    );
  }
});

// Mount API routes. The static catch-all must stay last so it cannot shadow
// the API.
app.route("/auth", authRoutes);
app.route("/articles", articleRoutes);
app.use("/*", serveStatic({ root: "./public" }));

app.get("/", serveStatic({ path: "./public/index.html" }));

export { app };
