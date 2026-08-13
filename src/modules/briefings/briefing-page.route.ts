/**
 * `GET /api/briefings/:slug/page` - the document behind `/b/:slug`.
 *
 * `vercel.json` rewrites the public path here, so the pretty URL is what a reader sees while the code that serves it stays under `/api` with everything else the server owns.
 *
 * Two segments deliberately.
 * The public router matches `/:slug` first, and a single-segment path added under this prefix would be shadowed by it rather than served - the trap `briefings.route.ts` documents and `briefings.test.ts` fails on. `/:slug/page` cannot collide with it.
 */

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { slugParamSchema } from "./briefings.schema.js";
import { getBriefingBySlug } from "./briefings.service.js";
import { buildBriefingPage } from "./briefing-page.shell.js";

const briefingPageRoutes = new Hono();

/**
 * Where this deployment thinks it is.
 *
 * Taken from the forwarded headers rather than hard-coded, so a preview describes itself as the preview instead of claiming to be production and sending every shared preview link to the live site.
 * Falls back to the request URL, which is what local development and the test suite see.
 */
function originOf(c: Context): string {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (!host) return new URL(c.req.url).origin;

  // The scheme comes from the request rather than defaulting to https, so a local server does not advertise itself as https://localhost and produce a canonical URL nothing can fetch.
  // Vercel always sets the forwarded header, so production and previews take that branch.
  const proto =
    c.req.header("x-forwarded-proto") ??
    new URL(c.req.url).protocol.replace(":", "");

  return `${proto}://${host}`;
}

briefingPageRoutes.get(
  "/:slug/page",
  zValidator("param", slugParamSchema),
  async (c) => {
    const { slug } = c.req.valid("param");

    // Read as an anonymous viewer, always.
    //
    // A browser cannot put an Authorization header on a document request;
    //  the token lives in localStorage and only travels on fetches the page makes;
    // so there is no viewer to identify here, and pretending otherwise would make this route answer differently from the thing it serves.
    // A draft therefore comes back null and produces the same shell as an address that never existed, which is the property that keeps it private.
    // The author sees their own draft a moment later, when the page asks with the token.
    let briefing = null;

    try {
      briefing = await getBriefingBySlug(slug, null);
    } catch (error) {
      // A failed read must not take the page down with it:
      // the shell still renders and the client asks again, which is a worse page rather than no page.
      // Logged server-side because it is a real fault.
      console.error("Briefings error while loading a briefing page:", error);
    }

    return c.html(buildBriefingPage({ briefing, origin: originOf(c), slug }));
  }
);

export { briefingPageRoutes };
