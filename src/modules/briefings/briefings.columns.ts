/**
 * The briefings columns the API depends on.
 *
 * Same job as the wire's and the desk's lists, for the same reason:
 * a database missing one of these serves every other page perfectly and fails only here.
 * Both tables have been on the deployed databases since the Postgres migration
 *  - checked directly rather than assumed -
 * so nothing needs migrating, but /api/health has never asked about either of them, and a probe that cannot see a table an endpoint writes to turns db/README.md's "curl it after any schema change" into a false pass.
 *
 * Runtime-import free, like the other two, so the apply script can read this without building a pool.
 */

import type { TableProbe } from "../../db/schema-probe.js";

export const BRIEFING_COLUMNS = [
  "id",
  "author_id",
  "title",
  "intro",
  "slug",
  "status",
  "published_at",
  "created_at",
  "updated_at",
] as const;

export const BRIEFING_ITEM_COLUMNS = [
  "id",
  "briefing_id",
  "story_id",
  "note",
  "position",
] as const;

export const BRIEFINGS_PROBE: TableProbe = {
  table: "briefings",
  columns: BRIEFING_COLUMNS,
};

export const BRIEFING_ITEMS_PROBE: TableProbe = {
  table: "briefing_items",
  columns: BRIEFING_ITEM_COLUMNS,
};
