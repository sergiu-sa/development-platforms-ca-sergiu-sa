/**
 * Briefing Routes - what a curator filed, and everything that changes it.
 *
 * Two routers, mounted on the same prefix in src/app.ts:
 *
 *   publicBriefingRoutes   GET /briefings          filed briefings, newest first
 *                          GET /briefings/:slug    a draft only for its own author
 *
 *   briefingRoutes         POST   /briefings                   start a draft
 *                          PATCH  /briefings/:id               retitle, rewrite, file, withdraw
 *                          DELETE /briefings/:id
 *                          POST   /briefings/:id/items         add a story to the end
 *                          PATCH  /briefings/:id/items/:itemId rewrite one note
 *                          DELETE /briefings/:id/items/:itemId take a story out
 *                          PUT    /briefings/:id/items         set the whole order
 *
 * **Why two routers rather than one.** This prefix has to serve public reads as well as private writes, so it cannot put authMiddleware on everything the way /api/desk does.
 * The first version tested the HTTP method instead - GET public, everything else authenticated - and that was wrong in two measured ways.
 * Hono re-dispatches HEAD through the GET chain while `c.req.method` still reads "HEAD", so every HEAD on a public read answered 401.
 * And it made *exposure* the default for reads: a private GET added later
 * - listing your own drafts is the next one anybody will want -
 * would have been anonymous unless its handler remembered to check, which is the "published by forgetting a line" failure the desk's blanket registration exists to make impossible.
 *
 * Declaring publicness by which router a route is in restores that.
 * Writes are protected because they live behind a blanket `use("*")`, not because of anything about their verb.
 *
 * **One consequence worth knowing.**
 * The public router is mounted first, and has to be: Hono runs matched handlers in registration order, so mounting the private one first would put its blanket middleware in front of the public reads and 401 them.
 * That means `GET /briefings/:slug` matches any single segment before the private router is consulted, so a private GET added at a one-segment path is shadowed by it rather than protected.
 * That fails closed and loudly - the feature simply does not work - which is the right direction, but the fix is a two-segment path or a different prefix, not a third router.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  authMiddleware,
  optionalAuth,
  viewerId,
} from "../../middleware/auth.js";
import {
  addItem,
  createBriefing,
  deleteBriefing,
  getBriefingBySlug,
  listPublished,
  removeItem,
  reorderItems,
  updateBriefing,
  updateItem,
} from "./briefings.service.js";
import { failed, pageEnvelope, refused } from "./briefings.responses.js";
import {
  addItemSchema,
  briefingIdParamSchema,
  createBriefingSchema,
  itemParamSchema,
  pageQuerySchema,
  reorderItemsSchema,
  slugParamSchema,
  updateBriefingSchema,
  updateItemSchema,
} from "./briefings.schema.js";

const publicBriefingRoutes = new Hono();

// Reads a token when one is offered and carries on either way.
// It grants nothing on its own
//  - the service still decides what an anonymous caller may see
//  - it only makes the difference between "a stranger" and "the author" expressible on a page anybody can open.
publicBriefingRoutes.use("*", optionalAuth);

const briefingRoutes = new Hono();

briefingRoutes.use("*", authMiddleware);

/**
 * Whose briefing this is comes from the verified token, never from the path, the query or the body.
 * Only reachable on the private router, whose blanket middleware is what put the user there.
 */
function ownerOf(c: Context): number {
  // Non-null because this router's blanket authMiddleware is what put the user there, and it answers 401 rather than calling next() when it cannot.
  // The assertion is deliberately local:
  // it is a claim about this router, checkable against the use("*") ten lines above, rather than a lie in the type.
  return c.get("user")!.userId;
}

publicBriefingRoutes.get(
  "/",
  zValidator("query", pageQuerySchema),
  async (c) => {
    try {
      const page = c.req.valid("query").page ?? 1;
      const { briefings, total } = await listPublished(page);

      return c.json({ success: true, ...pageEnvelope(page, total, briefings) });
    } catch (error) {
      return failed(c, error, "loading briefings");
    }
  }
);

publicBriefingRoutes.get(
  "/:slug",
  zValidator("param", slugParamSchema),
  async (c) => {
    try {
      const { slug } = c.req.valid("param");
      const briefing = await getBriefingBySlug(slug, viewerId(c));

      // A draft belongs to its author and does not exist for anybody else, so this is the same 404 a made-up address gets, word for word
      //  - which is why it comes from the refusal table rather than being written here.
      if (!briefing) {
        return refused(c, "not-found");
      }

      return c.json({ success: true, briefing });
    } catch (error) {
      return failed(c, error, "loading that briefing");
    }
  }
);

briefingRoutes.post(
  "/",
  zValidator("json", createBriefingSchema),
  async (c) => {
    try {
      const briefing = await createBriefing(ownerOf(c), c.req.valid("json"));

      return c.json({ success: true, briefing }, 201);
    } catch (error) {
      return failed(c, error, "creating your briefing");
    }
  }
);

briefingRoutes.patch(
  "/:id",
  zValidator("param", briefingIdParamSchema),
  zValidator("json", updateBriefingSchema),
  async (c) => {
    try {
      const result = await updateBriefing(
        ownerOf(c),
        c.req.valid("param").id,
        c.req.valid("json")
      );

      return result.ok
        ? c.json({ success: true, briefing: result.value })
        : refused(c, result.reason);
    } catch (error) {
      return failed(c, error, "updating your briefing");
    }
  }
);

briefingRoutes.delete(
  "/:id",
  zValidator("param", briefingIdParamSchema),
  async (c) => {
    try {
      const removed = await deleteBriefing(ownerOf(c), c.req.valid("param").id);

      // Unlike the desk, a delete that matched nothing is a 404 rather than a success.
      // The desk states an end state for one story;
      // this names a whole briefing, and reporting success for one that is not there would tell a curator their work was deleted when it was somebody else's id.
      return removed
        ? c.json({ success: true, removed: true })
        : refused(c, "not-found");
    } catch (error) {
      return failed(c, error, "deleting your briefing");
    }
  }
);

briefingRoutes.post(
  "/:id/items",
  zValidator("param", briefingIdParamSchema),
  zValidator("json", addItemSchema),
  async (c) => {
    try {
      const result = await addItem(
        ownerOf(c),
        c.req.valid("param").id,
        c.req.valid("json")
      );

      return result.ok
        ? c.json({ success: true, item: result.value }, 201)
        : refused(c, result.reason);
    } catch (error) {
      return failed(c, error, "adding that story");
    }
  }
);

briefingRoutes.patch(
  "/:id/items/:itemId",
  zValidator("param", itemParamSchema),
  zValidator("json", updateItemSchema),
  async (c) => {
    try {
      const { id, itemId } = c.req.valid("param");
      const result = await updateItem(
        ownerOf(c),
        id,
        itemId,
        c.req.valid("json")
      );

      return result.ok
        ? c.json({ success: true, item: result.value })
        : refused(c, result.reason);
    } catch (error) {
      return failed(c, error, "updating that note");
    }
  }
);

briefingRoutes.delete(
  "/:id/items/:itemId",
  zValidator("param", itemParamSchema),
  async (c) => {
    try {
      const { id, itemId } = c.req.valid("param");
      const result = await removeItem(ownerOf(c), id, itemId);

      return result.ok
        ? c.json({ success: true, removed: true })
        : refused(c, result.reason);
    } catch (error) {
      return failed(c, error, "removing that story");
    }
  }
);

briefingRoutes.put(
  "/:id/items",
  zValidator("param", briefingIdParamSchema),
  zValidator("json", reorderItemsSchema),
  async (c) => {
    try {
      const result = await reorderItems(
        ownerOf(c),
        c.req.valid("param").id,
        c.req.valid("json").itemIds
      );

      return result.ok
        ? c.json({ success: true, items: result.value })
        : refused(c, result.reason);
    } catch (error) {
      return failed(c, error, "reordering your briefing");
    }
  }
);

export { briefingRoutes, publicBriefingRoutes };
