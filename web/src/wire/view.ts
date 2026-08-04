/**
 * What the browse list is currently showing: which pillar, in what order, and
 * whether decided stories are still on screen.
 *
 * Pure, like `deck.ts`, and deliberately separate from it. The deck does not
 * read the filter - it deals from the top of the wire whichever chip is
 * pressed - and none of this is persisted, so folding it into the deck's state
 * would put a throwaway preference inside the one thing the whole page agrees
 * on. Decisions stay in the single store; this only decides what is drawn.
 */

import type { Decision, Story } from "./types";

export type SortOrder = "newest" | "pillar";

export interface ViewState {
  /** `null` is Everything. A pillar name filters to it. */
  pillar: string | null;
  sort: SortOrder;
  hideDecided: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  pillar: null,
  sort: "newest",
  hideDecided: false,
};

/**
 * The pillars actually present on the wire, for the filter chips.
 *
 * Derived from the stories rather than hard-coded to the Guardian's five,
 * because a chip that filters to nothing is a dead end the reader has to back
 * out of. Stories with no pillar are left out: they cannot be filed under one,
 * and a blank chip would be worse than their absence.
 */
export function pillarsOf(stories: readonly Story[]): string[] {
  const found = new Set<string>();
  for (const story of stories) if (story.pillar) found.add(story.pillar);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * Sorts a pillar-less story last.
 *
 * `localeCompare` against an empty string would sort it to the front, putting
 * the least classifiable stories above everything the reader asked to group.
 */
function byPillar(a: Story, b: Story): number {
  if (a.pillar === b.pillar) return 0;
  if (!a.pillar) return 1;
  if (!b.pillar) return -1;
  return a.pillar.localeCompare(b.pillar);
}

/**
 * The stories the list should draw, given the wire, what the reader has done,
 * and what they have asked to see.
 *
 * "newest" is the wire's own order rather than a re-sort by date: the API
 * already serves `published_at DESC` and the deck deals in exactly that order,
 * so re-deriving it here would be a second copy of the same rule, free to
 * disagree with the deck about what story 3 is.
 *
 * The sort copies first. `DeckState.stories` is the array the deck derives its
 * cursor from, and reordering it in place would move the deck's stories
 * underneath it while `decisions` still keys the old positions.
 */
export function visibleStories(
  stories: readonly Story[],
  decisions: ReadonlyMap<number, Decision>,
  view: ViewState
): Story[] {
  const shown = stories.filter((story) => {
    if (view.pillar !== null && story.pillar !== view.pillar) return false;
    if (view.hideDecided && decisions.has(story.id)) return false;
    return true;
  });

  return view.sort === "pillar" ? shown.sort(byPillar) : shown;
}
