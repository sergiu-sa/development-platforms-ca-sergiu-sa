/**
 * News API - Application Wiring
 *
 * Builds the Hono app without starting a server, so tests can drive it through app.fetch() directly. src/index.ts is the entry point that actually listens.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config/env.js";
import { pool } from "./db/connection.js";
import { checkSchema, isSchemaError } from "./db/schema-probe.js";
import { SCHEMA_PROBES } from "./db/probes.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { deskRoutes } from "./modules/desk/desk.route.js";
import { wireRoutes } from "./modules/wire/wire.route.js";
import {
  briefingRoutes,
  publicBriefingRoutes,
} from "./modules/briefings/briefings.route.js";
import { briefingPageRoutes } from "./modules/briefings/briefing-page.route.js";
import { curatorRoutes } from "./modules/briefings/curators.route.js";

// strict: false so a trailing slash means the same route.
//
// Not cosmetic.
// With the default, GET /api/briefings/ matched neither the public listing at "/" nor "/:slug" (which will not take an empty segment), fell through to the private router's blanket middleware, and answered a public front page with 401 "Authentication required".
// Loosening the match takes nothing away: the private router still covers /api/briefings/ with the same use("*"), so a write with a trailing slash is refused exactly as before, and tests/briefings.test.ts pins both halves.
const app = new Hono({ strict: false });

// Security headers on everything, API and static files alike.
// Registered first so it wraps every later handler.
//
// The CSP is written against what the current pages actually load.
// Tailwind is now a real build step (Vite + @tailwindcss/vite) rather than a CDN script that compiles in the browser, so script-src needs neither the CDN origin nor 'unsafe-eval'.
// Fonts are self-hosted via @fontsource-variable, bundled as same-origin files, so font-src no longer needs data:.
// 'unsafe-inline' has been removed from style-src.
// It was blamed on the decay ramp, but that was never the real reason: setting a property through the CSSOM (element.style.setProperty) is not subject to CSP at all.
// What actually required it was style attributes parsed from markup - style="display:none" on the nav elements, and the clock rail interpolating style="top:..." into an innerHTML string.
// Both are gone, so the allowance is gone with them.
// Anything that needs a dynamic value must go through the CSSOM, never setAttribute.
//
// img-src carries media.guim.co.uk because wire thumbnails are hotlinked from the Guardian rather than proxied.
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

// Everything the server owns lives under /api. Vercel serves the Hono app at /api/*, with the frontend as static assets on the same origin, so this prefix is the deployment shape rather than decoration.
const api = new Hono();

// Health check.
// It answers two questions at once: can the database bereached, and does it have the shape /api/wire needs?
//
// It used to answer only the first, with SELECT 1, and that gap cost three days of a dead homepage: SELECT 1 succeeds against a database missing every column the wire selects.
// db/README.md has the full account.
// Since phase 5 there are two hosted databases that can be missing one, so this is worth getting right.
//
// One query does both jobs, because a query cannot run without a connection.
// That matters more than it looks: on Vercel each instance holds a pool of a single connection, so a second round trip here doubles how long a polled public endpoint occupies the one connection real requests are queued behind.
api.get("/health", async (c) => {
  const timestamp = new Date().toISOString();
  // Every table the API needs, not just the wire's.
  // A probe that covers one feature answers "ok" for a database the rest of the app cannot use, and the desk is the case that proves it: its writes are swallowed by design, so a missing saved_stories is invisible from the outside.
  // The list is composed in src/db/probes.ts, which the apply script reads too.
  const schema = await checkSchema(pool, SCHEMA_PROBES);

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
api.route("/desk", deskRoutes);
// Briefings serve public reads and private writes on the same prefix, so unlike /api/desk they cannot sit behind one blanket authMiddleware.
// Two routers make the split instead, and the order is load-bearing:
// Hono runs matched handlers in registration order, so the public reads must be mounted first or the private router's blanket middleware would 401 them.
// The header of briefings.route.ts has the full reasoning and the one consequence.
// The document behind /b/:slug, which vercel.json rewrites to this path.
// It only has to precede the PRIVATE router, whose blanket middleware would otherwise answer 401 to a public read.
// Its path is two segments, so the public "/:slug" cannot shadow it in either order.
api.route("/briefings", briefingPageRoutes);
api.route("/briefings", publicBriefingRoutes);
api.route("/briefings", briefingRoutes);
api.route("/curators", curatorRoutes);

// CORS - only for the API routes, and only for origins we explicitly name.
// The bundled frontend is same-origin, so it needs no CORS headers;
// this exists purely for a separately hosted frontend.
// No ALLOWED_ORIGINS means no CORS.
// Both paths are listed, though only one is needed:
// measured in phase 8, a trailing "/*" compiles to "(?:|/.*)" in this version of Hono, so "/api/*" does match "/api" itself.
// An earlier comment here claimed the opposite.
// Kept as written because a redundant registration costs nothing and a wrong assumption about wildcard matching is what the phase 8 review had to disprove by running it.
if (config.allowedOrigins.length > 0) {
  const corsMiddleware = cors({ origin: config.allowedOrigins });

  for (const path of ["/api", "/api/*"]) {
    app.use(path, corsMiddleware);
  }
}

app.route("/api", api);

// API only, deliberately.
// The frontend is served by src/index.ts in local development and by Vercel's CDN in production, so nothing in here may depend on a Node server being present;
//  @hono/node-server's serveStatic cannot run in a serverless function.
export { app };
