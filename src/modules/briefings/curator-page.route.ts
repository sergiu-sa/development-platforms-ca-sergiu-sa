/**
 * The document behind `/u/:username`, served at two paths by one handler.
 *
 * `/u/:username` is the public address a reader's browser asks for.
 * `/api/curators/:username/page` is the same page under the prefix the rest of the server lives at.
 *
 * **Both mounts are needed**, and phase 9 paid for finding that out.
 * `vercel.json` rewrites the pretty path to the API one, which is what routes the request to the function at all - but `hono/vercel` rebuilds the request from the ORIGINAL url, so the router still sees `/u/:username`.
 * Mounted only under `/api`, this page would be live, correct, and answering Hono's own 404 on the only address anybody uses.
 * No local check can see it: the tests drive `app.fetch()`, and `src/index.ts` serves the app before it serves files.
 *
 * The API path keeps its two segments deliberately, exactly as the briefing page does.
 * `curatorRoutes` matches `/:username` on the same prefix, so a single-segment path added here would be shadowed by the JSON listing rather than served.
 *
 * This route reads nothing private and needs no token.
 * `listByCurator` is published-only with no branch on who is asking, which is what makes a document request - which can never carry an Authorization header - the right shape for it rather than a compromise.
 */

import { Hono, type Context } from "hono";
import { originOf } from "../../html/origin.js";
import { curatorParamSchema, pageQuerySchema } from "./briefings.schema.js";
import { pageEnvelope } from "./briefings.responses.js";
import { listByCurator } from "./briefings.service.js";
import { buildCuratorPage, type CuratorLookup } from "./curator-page.shell.js";

/** Mounted under /api/curators. */
const curatorPageRoutes = new Hono();

/** Mounted at the root, on the public path readers actually request. */
const curatorPublicPageRoutes = new Hono();

/**
 * A document answers for every input, the same way `/b/:slug` does.
 *
 * A name that cannot be a username is not sent to Postgres, but it does not become a JSON 400 either - it falls through to the shell that describes nothing, so a mistyped profile address renders as a page rather than as an error object.
 */
function readUsername(raw: string | undefined): string | null {
  const parsed = curatorParamSchema.safeParse({ username: raw });

  return parsed.success ? parsed.data.username : null;
}

/** Same tolerance for `?page=`: nonsense opens page 1 rather than refusing to draw. */
function readPage(raw: string | undefined): number {
  const parsed = pageQuerySchema.safeParse({ page: raw });

  return (parsed.success ? parsed.data.page : undefined) ?? 1;
}

/**
 * What the lookup found, as one value rather than two fields.
 *
 * Three states, and a boolean beside a nullable shelf made a fourth representable - a described curator whose payload was withheld, which type-checks and sends every reader a needless second request.
 * The same argument the schema makes one table along: there is no `is_lead` column, because a boolean admits two leads or none.
 */
async function lookUp(
  username: string | null,
  page: number
): Promise<CuratorLookup> {
  // A name that could never be a username is *missing*, not unavailable.
  //
  // Nothing was asked, but the answer is known anyway: no account can hold a name registration would refuse, so the lookup could only ever have come back empty.
  // Calling it unavailable inlined nothing, which sent the client off to ask a question with one possible answer
  // - a wasted function invocation on every scanned `/u/` address, and a page reading "The connection failed.
  // Reload to try again." for an address that can never resolve.
  if (!username) return { state: "missing" };

  try {
    const curator = await listByCurator(username, page);

    // The database answered. `curator` being null is that answer, not a failure.
    if (!curator) return { state: "missing" };

    return {
      state: "found",
      shelf: {
        // The stored spelling, not the requested one, so a byline typed in the wrong case still prints correctly and the canonical URL is stable.
        username: curator.username,
        // The same envelope the JSON listing sends, so the inlined payload and the fetched one cannot describe a page differently.
        ...pageEnvelope(page, curator.total, curator.briefings),
      },
    };
  } catch (error) {
    // A failed read must not take the page down with it: the shell still renders and the client asks again, which is a worse page rather than no page.
    console.error("Briefings error while loading a curator page:", error);

    return { state: "unavailable" };
  }
}

async function servePage(c: Context) {
  const lookup = await lookUp(
    readUsername(c.req.param("username")),
    readPage(c.req.query("page"))
  );

  return c.html(buildCuratorPage({ lookup, origin: originOf(c) }));
}

curatorPageRoutes.get("/:username/page", servePage);
curatorPublicPageRoutes.get("/:username", servePage);

export { curatorPageRoutes, curatorPublicPageRoutes };
