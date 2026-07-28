/**
 * Wire Routes
 * GET /wire?section=&page= - Cached story wire, always served from Postgres.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getWirePage, WIRE_PAGE_SIZE } from "./wire.service.js";
import { wireQuerySchema } from "./wire.schema.js";

const wireRoutes = new Hono();

wireRoutes.get("/", zValidator("query", wireQuerySchema), async (c) => {
  try {
    const { section, page } = c.req.valid("query");
    const currentPage = page ?? 1;
    const wire = await getWirePage({ section, page: currentPage });

    return c.json({
      success: true,
      // Staleness is information, not an error: the client shows a quiet
      // timestamp rather than a failure state.
      stale: wire.stale,
      fetchedAt: wire.fetchedAt,
      page: currentPage,
      pageSize: WIRE_PAGE_SIZE,
      total: wire.total,
      stories: wire.stories,
    });
  } catch (error) {
    console.error("Wire error:", error);
    return c.json(
      { success: false, message: "An error occurred loading the wire" },
      500
    );
  }
});

export { wireRoutes };
