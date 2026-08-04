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
import { checkWireSchema, isSchemaError } from "./modules/wire/wire.columns.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { wireRoutes } from "./modules/wire/wire.route.js";

const app = new Hono();

// Security headers on everything, API and static files alike. Registered first
// so it wraps every later handler.
//
// The CSP is written against what the current pages actually load. Tailwind
// is now a real build step (Vite + @tailwindcss/vite) rather than a CDN
// script that compiles in the browser, so script-src needs neither the CDN
// origin nor 'unsafe-eval'. Fonts are self-hosted via @fontsource-variable,
// bundled as same-origin files, so font-src no longer needs data:.
// 'unsafe-inline' has been removed from style-src. It was blamed on the decay
// ramp, but that was never the real reason: setting a property through the
// CSSOM (element.style.setProperty) is not subject to CSP at all. What actually
// required it was style attributes parsed from markup - style="display:none" on
// the nav elements, and the clock rail interpolating style="top:..." into an
// innerHTML string. Both are gone, so the allowance is gone with them. Anything
// that needs a dynamic value must go through the CSSOM, never setAttribute.
//
// img-src carries media.guim.co.uk because wire thumbnails are hotlinked from
// the Guardian rather than proxied.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "https://media.guim.co.uk", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
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

// Health check. It answers two questions at once: can the database be
// reached, and does it have the shape /api/wire needs?
//
// It used to answer only the first, with SELECT 1, and that gap cost three
// days of a dead homepage: SELECT 1 succeeds against a database missing every
// column the wire selects. db/README.md has the full account. Since phase 5
// there are two hosted databases that can be missing one, so this is worth
// getting right.
//
// One query does both jobs, because a query cannot run without a connection.
// That matters more than it looks: on Vercel each instance holds a pool of a
// single connection, so a second round trip here doubles how long a polled
// public endpoint occupies the one connection real requests are queued behind.
api.get("/health", async (c) => {
  const timestamp = new Date().toISOString();
  const schema = await checkWireSchema(pool);

  if (schema.ok) {
    return c.json({
      status: "healthy",
      database: "connected",
      schema: "ok",
      timestamp,
    });
  }

  // A SQLSTATE means Postgres answered and only the shape was wrong.
  // Anything else - a Node error code, or none - means we never got that far.
  const reachable = isSchemaError(schema.code);

  console.error(
    reachable
      ? "Health check found an out-of-date schema:"
      : "Health check could not reach the database:",
    schema.cause
  );

  return c.json(
    reachable
      ? {
          status: "degraded",
          database: "connected",
          schema: "stale",
          detail: schema.detail,
          timestamp,
        }
      : { status: "unhealthy", database: "disconnected", timestamp },
    503
  );
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
