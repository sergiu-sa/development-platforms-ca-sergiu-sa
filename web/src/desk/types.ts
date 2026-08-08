/**
 * The desk's response contract.
 *
 * Mirrors `DeskDecision` and `DeskEntry` in `src/modules/desk/desk.service.ts` rather than reshaping them: the route passes service objects straight through, so this is what arrives on the wire.
 */

import type { Decision, Story } from "../wire/types";

/** What the compact form returns: the decision, without the story. */
export interface DeskDecision {
  storyId: number;
  state: Decision;
  decidedAt: string;
}

/** What the full form returns, inside a window. */
export interface DeskEntry extends DeskDecision {
  story: Story;
}
