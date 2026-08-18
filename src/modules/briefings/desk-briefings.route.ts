/**
 * The briefings on your own desk.
 *
 * GET /desk/briefings  Everything you have written, drafts included
 *
 * **Why it is not under /briefings.** That prefix mounts a public router first, and it has to
 *  - Hono runs matched handlers in registration order, so putting the private one first would answer 401 to the public reads.
 * The consequence is that `GET /briefings/:slug` matches any single segment before the private router is ever consulted, so `GET /briefings/mine` would be read as a request for a briefing whose address is "mine" and answered 404.
 * The fix that comment recommends is a two-segment path or a different prefix. This is the different prefix.
 *
 * **And it belongs here on its own terms.** The desk is the reader's private surface and the place the design says a briefing is started;
 * `/briefings` is the public shelf. "What I am still writing" is desk-shaped.
 *
 * It lives in the briefings module despite mounting elsewhere, exactly as `curators.route.ts` does, because it returns briefings.
 *
 * Mounted **after** `deskRoutes` in app.ts, which is a choice about which path pays for the two blanket middlewares now covering this prefix. `src/app.ts` carries the measurement; the short version is that the other order taxes every Skip and Save on the deck to save one verification on a page load.
 *
 * The deeper fix is to stop borrowing this prefix at all: constrain the public briefings router's `:slug` to the shape a generated slug actually has, so a bare word like "mine" falls through to the private router and this can live at `GET /api/briefings/mine`. That is a change to a shipped route and to the test that currently pins the shadowing, so it is a loose end rather than part of this phase.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../../middleware/auth.js";
import { listOwn } from "./briefings.service.js";
import { failed, pageEnvelope } from "./briefings.responses.js";
import { pageQuerySchema } from "./briefings.schema.js";

const deskBriefingRoutes = new Hono();

deskBriefingRoutes.use("*", authMiddleware);

deskBriefingRoutes.get(
  "/briefings",
  zValidator("query", pageQuerySchema),
  async (c) => {
    try {
      const page = c.req.valid("query").page ?? 1;
      // Whose briefings, from the verified token and nowhere else. There is deliberately no way to name a curator here
      //  - somebody else's shelf is /api/curators/:username, and it is published-only.
      const { briefings, total } = await listOwn(c.get("user")!.userId, page);

      return c.json({ success: true, ...pageEnvelope(page, total, briefings) });
    } catch (error) {
      return failed(c, error, "loading your briefings");
    }
  }
);

export { deskBriefingRoutes };
