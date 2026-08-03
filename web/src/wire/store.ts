/**
 * The live deck state: the one thing that holds it, the one thing that writes
 * it, and the one thing both the deck and the browse list read.
 *
 * All the reasoning lives in `deck.ts`. This adds only the three things a pure
 * module cannot have - a current value, subscribers, and persistence.
 *
 * Everything is kept in `sessionStorage` for now, signed in or not. The desk
 * API does not exist until phase 6, which is also where a session is migrated
 * into an account on first login.
 */

import {
  createDeck,
  dealMore,
  decide,
  decideCurrent,
  undo,
  type DeckState,
  type RestoredSession,
} from "./deck";
import type { Decision, Story } from "./types";

const STORAGE_VERSION = 1;

/**
 * Versioned in the key itself, so a change of shape orphans the old value
 * instead of meeting code that cannot read it. Built from the one constant so
 * a bump cannot half-land, with the key moved and the check left behind.
 */
export const STORAGE_KEY = `lede.deck.v${STORAGE_VERSION}`;

/**
 * Reads a stored session, or null if there is nothing trustworthy there.
 *
 * Everything is checked rather than cast. The value is user-writable - it is
 * one devtools tab away - and a bad shape here would break the homepage on
 * load, which is the worst place in the product to fail.
 */
export function readSession(): Required<RestoredSession> | null {
  let raw: string | null;

  // Reading the object at all throws in some sandboxed contexts, so even the
  // access is guarded.
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (record.v !== STORAGE_VERSION) return null;

    const decisions = new Map<number, Decision>();
    const stored =
      typeof record.decisions === "object" && record.decisions !== null
        ? (record.decisions as Record<string, unknown>)
        : {};

    for (const [key, value] of Object.entries(stored)) {
      const id = Number(key);
      if (!Number.isInteger(id)) continue;
      if (value === "saved" || value === "skipped") decisions.set(id, value);
    }

    // A whole, non-negative count. `Number.isFinite` alone lets 12.5 through,
    // and a fractional batch propagates into every number derived from it:
    // the deck walks 13 stories while the gauge draws 12 ticks, and the panel
    // offers "Next 7.5 stories".
    const dealt =
      typeof record.dealt === "number" &&
      Number.isInteger(record.dealt) &&
      record.dealt >= 0
        ? record.dealt
        : 0;

    return { decisions, dealt };
  } catch {
    return null;
  }
}

/**
 * Persistence is a convenience, never a requirement: a full or unavailable
 * store costs the reader their session on reload and nothing else, so a throw
 * here must not reach the decision that caused it.
 */
export function writeSession(state: DeckState): void {
  const decisions: Record<string, Decision> = {};
  for (const [id, decision] of state.decisions) decisions[id] = decision;

  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: STORAGE_VERSION, decisions, dealt: state.dealt })
    );
  } catch {
    /* no session to restore next time; the deck still works now */
  }
}

export type Listener = (state: DeckState) => void;

export interface DeckStore {
  get(): DeckState;
  /** Calls the listener straight away, then on every change. */
  subscribe(listener: Listener): () => void;
  decideCurrent(to: Decision): void;
  decide(storyId: number, to: Decision): void;
  undo(): void;
  dealMore(): void;
}

export function createStore(stories: readonly Story[]): DeckStore {
  let state = createDeck(stories, readSession());
  const listeners = new Set<Listener>();

  // The pure functions hand back the identical state for a no-op, so an
  // unusable keypress neither writes storage nor repaints anything.
  const set = (next: DeckState): void => {
    if (next === state) return;
    state = next;
    writeSession(state);
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    decideCurrent: (to) => set(decideCurrent(state, to)),
    decide: (storyId, to) => set(decide(state, storyId, to)),
    undo: () => set(undo(state)),
    dealMore: () => set(dealMore(state)),
  };
}
