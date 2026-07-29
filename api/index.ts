/**
 * Vercel serverless entry point.
 *
 * Vercel never runs src/index.ts, so anything that has to happen before the
 * first request happens here instead. The app itself is shared with local
 * development and with the test suite - only the way it gets served differs.
 *
 * The frontend is not served from here. Vercel's CDN serves public/ directly,
 * which is also what gives static assets real Cache-Control headers.
 */

import { handle } from "hono/vercel";
import { validateEnv } from "../src/config/env.js";
import { app } from "../src/app.js";

// Throws on a missing variable, which surfaces as a failed invocation with the
// reason in the function logs. Better than serving requests against a database
// connection that was never configured.
validateEnv();

/**
 * Exported per HTTP method rather than as a default export.
 *
 * Vercel reads `export default` as the legacy Node signature `(req, res) =>
 * void`, where the response is written through `res` and any return value is
 * discarded. hono/vercel's handler *returns* a Response instead, so a default
 * export silently produced no reply at all and requests hung until they timed
 * out. Named method exports select the Web fetch-style signature, which is the
 * one this handler actually implements.
 *
 * Every method the API uses now, plus the ones the briefings routes will need,
 * so this does not have to be revisited.
 */
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
