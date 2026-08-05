/**
 * The saved_stories columns the desk depends on.
 *
 * This exists for the same reason the wire's list does, and phase 6 nearly
 * shipped without it. A deployment whose saved_stories is missing or the wrong
 * shape serves a working homepage: the deck deals, every Skip and Save
 * repaints immediately, and the writes fail into a sync that swallows failures
 * by design. No banner, no error on screen, nothing but a console line in a
 * runtime log. `/api/health` answered "ok" throughout, because it only ever
 * asked about stories.
 *
 * That is exactly the shape of the phase 1 outage - a green health check, a
 * swallowed write path and quiet logs - one table along. db/README.md tells
 * the operator to curl /api/health after any schema change, so a probe that
 * cannot see this table turns that instruction into a false pass.
 *
 * Runtime-import free, like the wire's list, so the apply script can read it
 * without building a pool.
 */

import type { TableProbe } from "../../db/schema-probe.js";

export const DESK_COLUMNS = [
  "id",
  "user_id",
  "story_id",
  "state",
  "decided_at",
] as const;

export const DESK_PROBE: TableProbe = {
  table: "saved_stories",
  columns: DESK_COLUMNS,
};
