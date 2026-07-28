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

const app = new Hono();

// Everything the server owns lives under /api. Vercel serves the Hono app at
// /api/*, with the frontend as static assets on the same origin, so this prefix
// is the deployment shape rather than decoration.
const api = new Hono();

// Health check endpoint for monitoring
api.get("/health", async (c) => {
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

api.route("/auth", authRoutes);

// CORS - only for the API routes, and only for origins we explicitly name.
// The bundled frontend is same-origin, so it needs no CORS headers; this exists
// purely for a separately hosted frontend. No ALLOWED_ORIGINS means no CORS.
// The bare path is listed alongside the wildcard because "/api/*" does not
// match "/api" itself.
if (config.allowedOrigins.length > 0) {
  const corsMiddleware = cors({ origin: config.allowedOrigins });

  for (const path of ["/api", "/api/*"]) {
    app.use(path, corsMiddleware);
  }
}

app.route("/api", api);

// The static catch-all must stay last so it cannot shadow the API.
app.use("/*", serveStatic({ root: "./public" }));

app.get("/", serveStatic({ path: "./public/index.html" }));

export { app };
