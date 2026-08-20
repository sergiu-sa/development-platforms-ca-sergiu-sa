/**
 * Where this deployment thinks it is.
 *
 * Every generated document needs an absolute `og:url`, and getting it from the request rather than from a constant is what stops a preview deployment describing itself as production and sending every shared preview link to the live site.
 *
 * Lifted out of `briefing-page.route.ts` in phase 11, when `/u/:username` became the second page needing it.
 * It is one small function, and the reason it is shared rather than copied is the same reason the escapers are:
 * the two copies would be identical until the day one of them was fixed.
 */

import type { Context } from "hono";

export function originOf(c: Context): string {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (!host) return new URL(c.req.url).origin;

  // The scheme comes from the request rather than defaulting to https, so a local server does not advertise itself as https://localhost and produce a canonical URL nothing can fetch.
  // Vercel always sets the forwarded header, so production and previews take that branch.
  const proto =
    c.req.header("x-forwarded-proto") ??
    new URL(c.req.url).protocol.replace(":", "");

  return `${proto}://${host}`;
}
