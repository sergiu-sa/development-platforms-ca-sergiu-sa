/**
 * Copy that more than one surface has to agree on.
 *
 * The deck and the browse list both have to say what happened when the wire is
 * empty or unavailable, and they were saying it in words that had to be kept
 * in step by hand. The design spec is deliberate about this wording - an empty
 * state is an invitation, an error states what happened and what to do, and
 * neither apologises - so it is worth one place rather than two.
 */

import type { LastAction } from "./deck";
import type { Decision } from "./types";

/** A quiet newsroom, which is never an error. */
export const WIRE_QUIET_HEADING = "The wire is quiet.";
export const WIRE_QUIET_LINE = "Nothing has come through yet today.";
export const WIRE_QUIET_NOTE = "The wire refreshes every 15 minutes.";

/**
 * A view the reader has filtered down to nothing, which is neither of the
 * above: there are stories, and their own controls are hiding them. So it
 * names what did it and offers the way back, rather than reporting a quiet
 * newsroom that is not quiet.
 */
export const BROWSE_BLANK_HEADING = "Nothing here right now.";
export const BROWSE_BLANK_ALL = "You have decided on every story on the wire.";
export const BROWSE_BLANK_FILTERED = (pillar: string): string =>
  `No ${pillar} stories are left in this view.`;
export const BROWSE_RESET = "Show everything";

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

/**
 * What just happened, as the toast reports it.
 *
 * Taking a decision back is named after the button that offered it - Remove
 * gives "Removed", Un-skip gives "Un-skipped" - because the spec's rule is
 * that an action keeps its name for the whole flow. One word for both would
 * mean the toast answering a press of Remove with a verb the reader never
 * chose.
 */
export function actionLabel(action: LastAction): string {
  if (action.to !== null) return decisionLabel(action.to);
  return action.from === "saved" ? "Removed" : "Un-skipped";
}
