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

export default handle(app);
