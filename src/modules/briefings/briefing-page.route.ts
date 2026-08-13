/**
 * The document behind `/b/:slug`, served at two paths by one handler.
 *
 * `/b/:slug` is the public address and the one a reader's browser actually
 * asks for. `/api/briefings/:slug/page` is the same page under the prefix the
 * rest of the server lives at.
 *
 * **Both mounts are needed, and finding that out cost a deployment.**
 * `vercel.json` rewrites `/b/:slug` to the API path, which is what routes the
 * request to the function - but `hono/vercel` rebuilds the request from the
 * ORIGINAL url, so the router still sees `/b/:slug` and answered its own 404
 * for it. The page was live, correct, and unreachable.
 *
 * Nothing local could see it. The tests drive `app.fetch()` on the API path,
 * and `src/index.ts` re-dispatched the pretty path by hand, so both were
 * blind. This is the seam `CLAUDE.md` names twice: a passing test proves what
 * the app does, never what the deployed site does.
 *
 * The API path keeps its two segments deliberately. The public briefings
 * router matches `/:slug` first, and a single-segment path added under that
 * prefix would be shadowed rather than served - the trap `briefings.route.ts`
 * documents and `briefings.test.ts` fails on.
 */

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { slugParamSchema } from "./briefings.schema.js";
import { getBriefingBySlug } from "./briefings.service.js";
import { buildBriefingPage } from "./briefing-page.shell.js";

/** Mounted under /api/briefings. */
const briefingPageRoutes = new Hono();

/** Mounted at the root, on the public path readers actually request. */
const briefingPublicPageRoutes = new Hono();

/**
 * Where this deployment thinks it is.
 *
 * Taken from the forwarded headers rather than hard-coded, so a preview
 * describes itself as the preview instead of claiming to be production and
 * sending every shared preview link to the live site. Falls back to the
 * request URL, which is what local development and the test suite see.
 */
function originOf(c: Context): string {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (!host) return new URL(c.req.url).origin;

  // The scheme comes from the request rather than defaulting to https, so a
  // local server does not advertise itself as https://localhost and produce a
  // canonical URL nothing can fetch. Vercel always sets the forwarded header,
  // so production and previews take that branch.
  const proto =
    c.req.header("x-forwarded-proto") ??
    new URL(c.req.url).protocol.replace(":", "");

  return `${proto}://${host}`;
}

const validateSlug = zValidator("param", slugParamSchema);

async function servePage(c: Context) {
  const { slug } = c.req.valid("param" as never) as { slug: string };

  // Read as an anonymous viewer, always.
  //
  // A browser cannot put an Authorization header on a document request - the
  // token lives in localStorage and only travels on fetches the page makes -
  // so there is no viewer to identify here, and pretending otherwise would
  // make this route answer differently from the thing it serves. A draft
  // therefore comes back null and produces the same shell as an address that
  // never existed, which is the property that keeps it private. The author
  // sees their own draft a moment later, when the page asks with the token.
  let briefing = null;

  try {
    briefing = await getBriefingBySlug(slug, null);
  } catch (error) {
    // A failed read must not take the page down with it: the shell still
    // renders and the client asks again, which is a worse page rather than no
    // page. Logged server-side because it is a real fault.
    console.error("Briefings error while loading a briefing page:", error);
  }

  return c.html(buildBriefingPage({ briefing, origin: originOf(c), slug }));
}

briefingPageRoutes.get("/:slug/page", validateSlug, servePage);
briefingPublicPageRoutes.get("/:slug", validateSlug, servePage);

export { briefingPageRoutes, briefingPublicPageRoutes };
