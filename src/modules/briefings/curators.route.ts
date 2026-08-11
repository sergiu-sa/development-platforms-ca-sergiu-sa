/**
 * Curator Routes - somebody's public shelf.
 *
 * GET /curators/:username  Their filed briefings, newest first
 *
 * Entirely public and entirely published: no middleware, no token read, and no branch that could widen it.
 * Drafts are their author's business and are not reachable from here even by that author, which is why this file needs no concept of who is asking.
 *
 * It lives in the briefings module despite mounting elsewhere, because it returns briefings.
 * A curators module would have no table, no service and no schema of its own, and would import all three from here.
 *
 * The response carries `username` and never `email`.
 * This is the endpoint that rule was written for: an email here would publish the userbase to anyone who can guess a name.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { listByCurator } from "./briefings.service.js";
import { failed, pageEnvelope } from "./briefings.responses.js";
import { curatorParamSchema, pageQuerySchema } from "./briefings.schema.js";

const curatorRoutes = new Hono();

curatorRoutes.get(
  "/:username",
  zValidator("param", curatorParamSchema),
  zValidator("query", pageQuerySchema),
  async (c) => {
    try {
      const page = c.req.valid("query").page ?? 1;
      const curator = await listByCurator(c.req.valid("param").username, page);

      if (!curator) {
        return c.json(
          { success: false, message: "No curator by that name" },
          404
        );
      }

      return c.json({
        success: true,
        // Echoed back as it is stored rather than as it was typed, so a link written in the wrong case still prints the byline correctly.
        curator: { username: curator.username },
        ...pageEnvelope(page, curator.total, curator.briefings),
      });
    } catch (error) {
      return failed(c, error, "loading that curator");
    }
  }
);

export { curatorRoutes };
