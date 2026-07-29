/**
 * News API - Application Wiring
 *
 * Builds the Hono app without starting a server, so tests can drive it through
 * app.fetch() directly. src/index.ts is the entry point that actually listens.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config/env.js";
import { pool } from "./db/connection.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { wireRoutes } from "./modules/wire/wire.route.js";

const app = new Hono();

// Security headers on everything, API and static files alike. Registered first
// so it wraps every later handler.
//
// The CSP is written against what the current pages actually load. Two entries
// exist only because Tailwind ships from a CDN and compiles in the browser:
// the cdn.tailwindcss.com script source, and 'unsafe-eval' for its JIT. The
// Vite rebuild removes both, at which point this should tighten to 'self'.
//
// img-src carries media.guim.co.uk because wire thumbnails are hotlinked from
// the Guardian rather than proxied.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://media.guim.co.uk", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    // Only meaningful over HTTPS; harmless locally and correct once deployed.
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
  })
);

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
api.route("/wire", wireRoutes);

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

// API only, deliberately. The frontend is served by src/index.ts in local
// development and by Vercel's CDN in production, so nothing in here may depend
// on a Node server being present - @hono/node-server's serveStatic cannot run
// in a serverless function.
export { app };
