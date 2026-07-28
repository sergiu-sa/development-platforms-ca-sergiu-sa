/**
 * Rate limiting for authentication endpoints.
 *
 * Counts recent *failed* attempts per client and refuses once they exceed a
 * threshold. Successful requests are never recorded, so a legitimate user who
 * logs in correctly is never throttled no matter how often they do it.
 *
 * State lives in Postgres rather than process memory on purpose. The deploy
 * target is Vercel, where each serverless instance has its own memory and cold
 * starts wipe it, so an in-memory counter would barely inconvenience an
 * attacker. A shared table gives one budget across every instance.
 */

import type { Context, Next } from "hono";
import { pool } from "../db/connection.js";

/**
 * Best-effort client identity.
 *
 * Behind a proxy (Vercel) the real address is the first entry in
 * x-forwarded-for. Direct connections expose it on the Node socket. Requests
 * driven straight through app.fetch() in tests have neither, hence the
 * fallback - callers that need per-client isolation in a test set the header
 * explicitly.
 *
 * A spoofed x-forwarded-for only ever moves an attacker into a *different*
 * bucket, so the worst case is the limiter degrading to no protection for that
 * caller rather than letting them exhaust someone else's budget.
 */
function clientIdentifier(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 100);
  }

  const socket = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming?.socket;

  return socket?.remoteAddress ?? "unknown";
}

export interface RateLimitOptions {
  /** Namespace, so login and register do not share one budget. */
  scope: string;
  /** Failed attempts allowed inside the window. */
  limit: number;
  windowMinutes: number;
}

export function rateLimit(options: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    const identifier = clientIdentifier(c);

    let attempts = 0;

    try {
      // Prune expired rows on the way past. Keeps the table bounded without a
      // scheduled job, which the Vercel Hobby plan makes awkward.
      const { rows } = await pool.query<{ attempts: string }>(
        `WITH pruned AS (
           DELETE FROM auth_attempts
            WHERE attempted_at < now() - make_interval(mins => $1::int)
         )
         SELECT count(*) AS attempts
           FROM auth_attempts
          WHERE scope = $2
            AND identifier = $3
            AND attempted_at > now() - make_interval(mins => $1::int)`,
        [options.windowMinutes, options.scope, identifier]
      );

      attempts = Number(rows[0]?.attempts ?? 0);
    } catch (error) {
      // Fail open. A database hiccup should not lock every user out of login;
      // the endpoint behind this is still fully validated and authenticated.
      console.error("Rate limit check failed:", error);
      return next();
    }

    if (attempts >= options.limit) {
      const retryAfter = options.windowMinutes * 60;
      c.header("Retry-After", String(retryAfter));

      return c.json(
        {
          success: false,
          message: `Too many attempts. Please try again in ${options.windowMinutes} minutes.`,
        },
        429
      );
    }

    await next();

    // Only failures count toward the budget.
    if (c.res.status >= 400) {
      try {
        await pool.query(
          "INSERT INTO auth_attempts (scope, identifier) VALUES ($1, $2)",
          [options.scope, identifier]
        );
      } catch (error) {
        console.error("Rate limit record failed:", error);
      }
    }
  };
}
