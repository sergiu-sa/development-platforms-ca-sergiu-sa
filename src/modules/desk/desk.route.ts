/**
 * Desk Routes - a reader's own saved and skipped stories.
 *
 * GET    /desk?state=       Everything they have decided, newest first
 * PUT    /desk/:storyId     Save or skip one story
 * DELETE /desk/:storyId     Back to undecided
 * PUT    /desk              Fold a signed-out session into the account
 *
 * Every one of these is somebody's private data, so the whole sub-app sits
 * behind authMiddleware rather than each route opting in. A route added later
 * is protected by default and cannot be published by forgetting a line.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../../middleware/auth.js";
import {
  listDesk,
  listDeskCompact,
  mergeDecisions,
  removeDecision,
  setDecision,
} from "./desk.service.js";
import {
  decisionBodySchema,
  deskQuerySchema,
  mergeBodySchema,
  storyIdParamSchema,
} from "./desk.schema.js";

const deskRoutes = new Hono();

deskRoutes.use("*", authMiddleware);

/**
 * The one rule this file exists to keep: whose desk this is comes from the
 * verified token, never from the path, the query or the body. A request may
 * say anything it likes about who it is; the signature is the only part of it
 * that was checked.
 */
function ownerOf(c: Context): number {
  return c.get("user").userId;
}

/**
 * Logs the real cause and tells the client nothing about it, which is how the
 * rest of the API answers a failure it did not expect.
 */
function failed(c: Context, cause: unknown, doing: string) {
  console.error(`Desk error while ${doing}:`, cause);

  return c.json({ success: false, message: `An error occurred ${doing}` }, 500);
}

deskRoutes.get("/", zValidator("query", deskQuerySchema), async (c) => {
  try {
    const { state, view } = c.req.valid("query");
    const owner = ownerOf(c);

    const entries =
      view === "compact"
        ? await listDeskCompact(owner, state)
        : await listDesk(owner, state);

    return c.json({ success: true, total: entries.length, entries });
  } catch (error) {
    return failed(c, error, "loading your desk");
  }
});

deskRoutes.put(
  "/:storyId",
  zValidator("param", storyIdParamSchema),
  zValidator("json", decisionBodySchema),
  async (c) => {
    try {
      const { storyId } = c.req.valid("param");
      const { state } = c.req.valid("json");
      const entry = await setDecision(ownerOf(c), storyId, state);

      // No row means the story is not in the cache. 404 rather than 400: the
      // request was well formed, the thing it names is simply not here.
      if (!entry) {
        return c.json(
          { success: false, message: "That story is not on the wire" },
          404
        );
      }

      return c.json({ success: true, entry });
    } catch (error) {
      return failed(c, error, "updating your desk");
    }
  }
);

deskRoutes.delete(
  "/:storyId",
  zValidator("param", storyIdParamSchema),
  async (c) => {
    try {
      const { storyId } = c.req.valid("param");
      const removed = await removeDecision(ownerOf(c), storyId);

      // Removing something that was never there is a success. The client is
      // stating the end state it wants, and that state already holds.
      return c.json({ success: true, removed });
    } catch (error) {
      return failed(c, error, "updating your desk");
    }
  }
);

deskRoutes.put("/", zValidator("json", mergeBodySchema), async (c) => {
  try {
    const { entries } = c.req.valid("json");
    const result = await mergeDecisions(ownerOf(c), entries);

    return c.json({ success: true, ...result });
  } catch (error) {
    return failed(c, error, "updating your desk");
  }
});

export { deskRoutes };
