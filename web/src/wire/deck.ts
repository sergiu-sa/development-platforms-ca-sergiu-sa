/**
 * The deck's state machine.
 *
 * Pure. Every function takes a state and returns a new one, and nothing here
 * touches the DOM, the network or storage. That is what makes the signature
 * interaction testable without a browser.
 *
 * It is also the single model the whole page reads. Phase 4 adds the browse
 * list as a second consumer of this same state - a second store would let the
 * two surfaces disagree about what the reader has done.
 */

import type { Decision, Story } from "./types";

/**
 * How many stories the deck deals before it stops and offers more.
 *
 * The wire serves 20 a page and deciding all of them in one sitting is a long
 * ask, but a hard cap hides stories the reader can see listed below. Twelve
 * then the rest is the compromise: short enough to finish, and nothing is
 * withheld.
 */
export const BATCH_SIZE = 12;

export interface LastAction {
  storyId: number;
  /** What the story was before, so undo restores it rather than clearing it. */
  from: Decision | null;
  /**
   * `null` is Remove and Un-skip - a decision taken back rather than changed.
   * Both are first-class verbs in the design spec, and both are undoable, so
   * the shape that describes an action has to be able to say "none".
   */
  to: Decision | null;
}

export interface DeckState {
  /**
   * `readonly` is load-bearing rather than decorative. Every derived state
   * shares this one array, so an in-place sort or filter in a subscriber -
   * the obvious way to write phase 4's pillar filter - would reorder the deck
   * underneath its own cursor while `decisions` still keys the old positions.
   */
  stories: readonly Story[];
  decisions: ReadonlyMap<number, Decision>;
  /** How many stories from the top of the wire the reader has asked for. */
  dealt: number;
  lastAction: LastAction | null;
}

export type DeckStatus = "empty" | "dealing" | "batch-done" | "exhausted";

export interface DeckCounts {
  saved: number;
  skipped: number;
}

/**
 * A reader's session, as it comes back out of storage. Declared here rather
 * than in `store.ts` so the shape that is read and the shape that is restored
 * are one type instead of two that have to line up.
 */
export interface RestoredSession {
  decisions?: ReadonlyMap<number, Decision>;
  dealt?: number;
}

/**
 * Builds a deck, optionally restoring a reader's session.
 *
 * Restored decisions are filtered against the current wire: a story decided an
 * hour ago may have dropped off since, and an id nobody can see is a decision
 * nobody can undo.
 */
export function createDeck(
  stories: readonly Story[],
  restored?: RestoredSession | null
): DeckState {
  const known = new Set(stories.map((story) => story.id));
  const decisions = new Map<number, Decision>();

  for (const [id, decision] of restored?.decisions ?? []) {
    if (known.has(id)) decisions.set(id, decision);
  }

  return {
    stories,
    decisions,
    dealt: Math.min(stories.length, Math.max(BATCH_SIZE, restored?.dealt ?? 0)),
    lastAction: null,
  };
}

/**
 * The story on deck: the first undecided story inside the batch that has been
 * dealt, or null when the batch is finished.
 *
 * Derived rather than stored, and that is what makes undo correct for free.
 * Undoing a first decision leaves the story undecided, so the cursor lands
 * back on it. Undoing a change of mind restores the earlier decision, so the
 * story stays decided and the deck does not lurch backwards. Holding an index
 * means rebuilding both of those by hand.
 */
/**
 * How many stories are actually in the deck: what was dealt, clamped to what
 * is on the wire.
 *
 * Exported because the view and the announcer both need to say "N of M", and
 * three copies of this clamp is three chances for the number on screen to
 * disagree with the number spoken.
 */
export function dealtCount(state: DeckState): number {
  return Math.min(state.dealt, state.stories.length);
}

export function cursor(state: DeckState): number | null {
  const limit = dealtCount(state);

  for (let i = 0; i < limit; i++) {
    if (!state.decisions.has(state.stories[i].id)) return i;
  }

  return null;
}

export function currentStory(state: DeckState): Story | null {
  const index = cursor(state);
  return index === null ? null : state.stories[index];
}

export function deckStatus(state: DeckState): DeckStatus {
  if (state.stories.length === 0) return "empty";
  if (cursor(state) !== null) return "dealing";
  return state.dealt < state.stories.length ? "batch-done" : "exhausted";
}

/** How many stories are on the wire but not yet dealt to the deck. */
export function undealt(state: DeckState): number {
  return Math.max(0, state.stories.length - state.dealt);
}

/**
 * How many `dealMore()` would actually deal. The continuation button is
 * labelled with this, so it lives beside the function it describes rather than
 * being re-derived in the view - a label that promises eight and delivers
 * twelve is the kind of drift that only shows up in front of a user.
 */
export function nextBatchSize(state: DeckState): number {
  return Math.min(undealt(state), BATCH_SIZE);
}

/**
 * Counted across the whole wire rather than the dealt batch: the number is
 * what is on the reader's desk, and phase 4 lets the list decide a story the
 * deck has not reached.
 */
export function counts(state: DeckState): DeckCounts {
  let saved = 0;
  let skipped = 0;

  for (const decision of state.decisions.values()) {
    if (decision === "saved") saved++;
    else skipped++;
  }

  return { saved, skipped };
}

export function decisionFor(
  state: DeckState,
  storyId: number
): Decision | null {
  return state.decisions.get(storyId) ?? null;
}

/** Records a decision against any story on the wire. Unknown ids are ignored. */
export function decide(
  state: DeckState,
  storyId: number,
  to: Decision
): DeckState {
  if (!state.stories.some((story) => story.id === storyId)) return state;

  const from = state.decisions.get(storyId) ?? null;

  // Deciding what a story already is changes nothing, so it must not count as
  // an action. Recording it would overwrite lastAction and quietly spend the
  // reader's one step of undo on a no-op - pressing Save on an already-saved
  // row in phase 4's list would make the original save unrecoverable.
  if (from === to) return state;

  const decisions = new Map(state.decisions);
  decisions.set(storyId, to);

  return { ...state, decisions, lastAction: { storyId, from, to } };
}

/**
 * Takes a decision back, returning the story to undecided. Remove on a saved
 * story, Un-skip on a skipped one - one transition, because the difference is
 * only what it is called on screen.
 *
 * Recorded as an action so it undoes like any other. Clearing a story that was
 * never decided changes nothing and must not count, for the same reason
 * deciding a story the way it already is does not: the tray and the row can
 * both ask, and spending the reader's single step of undo on a no-op would
 * strand the decision before it.
 */
export function clearDecision(state: DeckState, storyId: number): DeckState {
  const from = state.decisions.get(storyId) ?? null;
  if (from === null) return state;

  const decisions = new Map(state.decisions);
  decisions.delete(storyId);

  return { ...state, decisions, lastAction: { storyId, from, to: null } };
}

/**
 * Decides the story currently on deck. A no-op once the batch is finished,
 * which is what stops a held-down key from running past the end.
 */
export function decideCurrent(state: DeckState, to: Decision): DeckState {
  const story = currentStory(state);
  return story === null ? state : decide(state, story.id, to);
}

/**
 * Reverses the last decision, from either surface.
 *
 * Single step: the toast that offers it is single step too, and a stack the
 * reader cannot see the depth of is a worse promise than one clear step back.
 */
export function undo(state: DeckState): DeckState {
  if (!state.lastAction) return state;

  const { storyId, from } = state.lastAction;
  const decisions = new Map(state.decisions);

  if (from === null) decisions.delete(storyId);
  else decisions.set(storyId, from);

  return { ...state, decisions, lastAction: null };
}

/** Deals the next batch. Stops at the end of the wire. */
export function dealMore(state: DeckState): DeckState {
  const dealt = Math.min(state.stories.length, state.dealt + BATCH_SIZE);
  return dealt === state.dealt ? state : { ...state, dealt };
}
