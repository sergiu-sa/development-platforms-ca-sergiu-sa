/**
 * Copy that more than one surface has to agree on.
 *
 * The deck and the browse list both have to say what happened when the wire is
 * empty or unavailable, and they were saying it in words that had to be kept
 * in step by hand. The design spec is deliberate about this wording - an empty
 * state is an invitation, an error states what happened and what to do, and
 * neither apologises - so it is worth one place rather than two.
 */

import type { Decision } from "./types";

/** A quiet newsroom, which is never an error. */
export const WIRE_QUIET_HEADING = "The wire is quiet.";
export const WIRE_QUIET_LINE = "Nothing has come through yet today.";
export const WIRE_QUIET_NOTE = "The wire refreshes every 15 minutes.";

/** A request that failed, which is a different thing entirely. */
export const WIRE_UNAVAILABLE_HEADING = "The wire is unavailable.";
export const WIRE_UNAVAILABLE_LINE =
  "Today's stories could not be loaded. Reload the page to try again.";

/**
 * A decision as a reader reads it.
 *
 * The row used to print the raw union member as visible copy, which quietly
 * made an internal value part of the interface. Capitalised because the
 * announcer speaks it at the start of a sentence; the furniture class renders
 * it uppercase on screen either way.
 */
export function decisionLabel(decision: Decision): string {
  return decision === "saved" ? "Saved" : "Skipped";
}
