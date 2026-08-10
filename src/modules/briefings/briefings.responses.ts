/**
 * How the briefings module answers, in one place.
 *
 * Two route files share this
 *  - the public reads and the writes -
 * and before it existed the 500 envelope was written out three times, once of them inline.
 * The refusal table matters more: it is the only place a status code is chosen, so "a stranger gets the same answer as a wrong id" is a property you can check by reading one object rather than by auditing nine handlers.
 */

import type { Context } from "hono";
import type { BriefingRefusal } from "./briefings.service.js";
import { BRIEFINGS_PAGE_SIZE, MAX_BRIEFING_ITEMS } from "./briefings.schema.js";

/** Logs the real cause and tells the client nothing about it. */
export function failed(c: Context, cause: unknown, doing: string) {
  console.error(`Briefings error while ${doing}:`, cause);

  return c.json({ success: false, message: `An error occurred ${doing}` }, 500);
}

/**
 * The one place a refusal becomes a status code.
 *
 * `not-found` covers a briefing that does not exist and one belonging to somebody else alike, deliberately:
 * answering 403 for the second would confirm that a draft with that id exists and whose it is not.
 * Every write gives a stranger exactly the same answer as a wrong id.
 *
 * Typed as a Record over the union, so a refusal added to the service without a status here is a compile error at the one place that has to know.
 */
const REFUSALS: Record<
  BriefingRefusal,
  { status: 404 | 409 | 400; message: string }
> = {
  "not-found": { status: 404, message: "That briefing does not exist" },
  "story-not-on-wire": {
    status: 404,
    message: "That story is not on the wire",
  },
  "story-already-in-briefing": {
    status: 409,
    message: "That story is already in this briefing",
  },
  "needs-a-story": {
    status: 409,
    message: "A briefing needs at least one story before it can be filed",
  },
  "published-needs-a-story": {
    status: 409,
    message:
      "A filed briefing needs at least one story. Move it back to a draft first.",
  },
  "briefing-is-full": {
    status: 409,
    message: `A briefing holds at most ${MAX_BRIEFING_ITEMS} stories`,
  },
  "ordering-must-match": {
    status: 400,
    message: "The order must list every story in this briefing exactly once",
  },
};

export function refused(c: Context, reason: BriefingRefusal) {
  const { status, message } = REFUSALS[reason];

  return c.json({ success: false, message }, status);
}

/**
 * The paging fields both listings carry, so the two cannot describe the same page differently.
 * The curator's shelf spreads this and adds its byline.
 */
export function pageEnvelope<T>(page: number, total: number, briefings: T[]) {
  return { page, pageSize: BRIEFINGS_PAGE_SIZE, total, briefings };
}
