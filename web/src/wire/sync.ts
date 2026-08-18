/**
 * Keeping a signed-in reader's decisions on their desk.
 *
 * The store stays exactly as synchronous and optimistic as it was: a decision
 * lands locally and repaints immediately, and this pushes it up afterwards.
 * That is the same bargain `writeSession` already makes - persistence is a
 * convenience, never a requirement - only the storage is further away.
 *
 * Two things here are load-bearing, and both are ways this could quietly
 * destroy somebody's desk rather than merely fail to save to it.
 *
 * `createDeck` filters restored decisions down to the stories currently on the
 * wire, so the store only ever knows about a slice of the desk. This therefore
 * diffs against **its own previous snapshot** and never against the server.
 * "Absent from the store" has to mean "not on this page", because it usually
 * does; reading it as "the reader removed it" would delete every older
 * decision on their account the moment the page loaded.
 *
 * Undo straight after a save produces a write and a delete for one story back
 * to back. If those overlapped and finished out of order the story would stay
 * on the desk with nothing on screen to say so, so the queue holds one entry
 * per story - the state it should end up in - and drains one request at a time.
 */

import {
  getDesk,
  putDeskDecision,
  deleteDeskDecision,
  mergeDesk,
  isFinalRefusal,
} from "../lib/api";
import { readSession, type DeckStore } from "./store";
import type { Decision } from "./types";

export type SyncIntent =
  | { kind: "set"; storyId: number; state: Decision }
  | { kind: "clear"; storyId: number };

/**
 * What changed between two sets of decisions.
 *
 * Only stories named in one of the two maps produce an intent, which is what
 * keeps decisions the store cannot see out of it entirely.
 */
export function diffDecisions(
  previous: ReadonlyMap<number, Decision>,
  next: ReadonlyMap<number, Decision>
): SyncIntent[] {
  const intents: SyncIntent[] = [];

  for (const [storyId, state] of next) {
    if (previous.get(storyId) !== state) {
      intents.push({ kind: "set", storyId, state });
    }
  }

  for (const storyId of previous.keys()) {
    if (!next.has(storyId)) {
      intents.push({ kind: "clear", storyId });
    }
  }

  return intents;
}

export interface DeskTransport {
  /** Resolves false only when the intent is worth trying again. */
  set(storyId: number, state: Decision): Promise<boolean>;
  clear(storyId: number): Promise<boolean>;
}

export interface DeskSync {
  observe(decisions: ReadonlyMap<number, Decision>): void;
  /** Resolves once the queue has stopped moving. */
  settled(): Promise<void>;
  /** Intents still waiting, because the last attempt at them failed. */
  pendingCount(): number;
}

export function createDeskSync(transport: DeskTransport): DeskSync {
  let snapshot: ReadonlyMap<number, Decision> | null = null;
  const pending = new Map<number, SyncIntent>();
  let draining: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (pending.size > 0) {
      const storyId: number = pending.keys().next().value!;
      const intent = pending.get(storyId)!;
      pending.delete(storyId);

      const sent =
        intent.kind === "set"
          ? await transport.set(storyId, intent.state)
          : await transport.clear(storyId);

      // Put a failure back and stop, unless the reader has already changed
      // their mind about that story - a newer intent is the truth and must not
      // be overwritten by the stale one we were retrying.
      if (!sent && !pending.has(storyId)) {
        pending.set(storyId, intent);
        break;
      }
    }

    draining = null;
  }

  return {
    observe(decisions) {
      // The first call establishes the baseline and sends nothing. The store
      // calls its listener immediately on subscribe, and at that moment its
      // decisions are the ones just hydrated from the account - writing them
      // all back would be pointless traffic that also reordered the desk.
      if (snapshot === null) {
        snapshot = new Map(decisions);
        return;
      }

      for (const intent of diffDecisions(snapshot, decisions)) {
        pending.set(intent.storyId, intent);
      }

      snapshot = new Map(decisions);

      if (!draining && pending.size > 0) {
        draining = drain();
      }
    },

    settled: () => draining ?? Promise.resolve(),
    pendingCount: () => pending.size,
  };
}

/**
 * A 4xx is the server's final answer and must not be retried; anything else
 * might be a blip worth another go on the reader's next decision.
 *
 * `isFinalRefusal` lives in `lib/api.ts` because the builder needs the same
 * rule and two copies of "which failures are permanent" is how they drift.
 * Its comment carries the reasoning, including why 401 is not on the list.
 *
 * One thing that reasoning does not cover and this does: an intent lost to a
 * 401 does not survive the redirect that a 401 triggers, because the queue is
 * in memory. Persisting it is the real fix and it is a loose end. What matters
 * here is only that the queue never claims to have done something it did not.
 */
export function createDeskTransport(): DeskTransport {
  return {
    async set(storyId, state) {
      const { status, body } = await putDeskDecision(storyId, state);
      return body?.success === true || isFinalRefusal(status);
    },
    async clear(storyId) {
      const { status, body } = await deleteDeskDecision(storyId);
      return body?.success === true || isFinalRefusal(status);
    },
  };
}

/** Subscribes a sync to a store. The first notification only sets a baseline. */
export function mountDeskSync(
  store: DeckStore,
  transport: DeskTransport = createDeskTransport()
): DeskSync {
  const sync = createDeskSync(transport);
  store.subscribe((state) => sync.observe(state.decisions));
  return sync;
}

/**
 * The account's decisions, or null when we could not ask.
 *
 * Null is not the same as an empty desk and the caller must not treat it as
 * one: falling back to the session keeps the reader's own decisions on screen
 * and, because the sync only ever sends changes it watched happen, leaves
 * everything already on the account untouched.
 */
export async function fetchAccountDecisions(): Promise<Map<
  number,
  Decision
> | null> {
  const response = await getDesk();

  if (!response?.success || !Array.isArray(response.entries)) {
    return null;
  }

  const decisions = new Map<number, Decision>();

  // Checked rather than cast, like readSession: this is a network response
  // being turned into the state the homepage renders from.
  for (const entry of response.entries) {
    const storyId = entry?.storyId;
    const state = entry?.state;

    if (
      Number.isInteger(storyId) &&
      (state === "saved" || state === "skipped")
    ) {
      decisions.set(storyId, state);
    }
  }

  return decisions;
}

/**
 * Set while a migration is owed and cleared once one has actually landed.
 *
 * It has to be written down somewhere rather than inferred, because the step
 * that consumes the session and the step that would notice it failed happen on
 * two different pages. Without it a failed merge is invisible: `request` never
 * rejects, so nothing throws, and the homepage then replaces the session's
 * decisions with the account's - which is the one place a whole session can
 * disappear in silence.
 *
 * In sessionStorage beside the session it refers to, so both die together when
 * the tab closes or a sign-out clears them.
 */
const MIGRATION_PENDING_KEY = "lede.desk.migration-pending";

function setPending(pending: boolean): void {
  try {
    if (pending) {
      window.sessionStorage.setItem(MIGRATION_PENDING_KEY, "1");
    } else {
      window.sessionStorage.removeItem(MIGRATION_PENDING_KEY);
    }
  } catch {
    /* a session that cannot be written cannot be migrated either */
  }
}

/** True when a session was left unmerged by an earlier attempt. */
export function migrationPending(): boolean {
  try {
    return window.sessionStorage.getItem(MIGRATION_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Folds the decisions made while signed out into the account.
 *
 * Returns whether the account now holds them. The caller must not discard the
 * session on a false: the flag is raised before the attempt and only lowered
 * once the server has confirmed, so an attempt cut short by the redirect that
 * follows sign-in is retried on the next page load rather than lost.
 *
 * Sliced because the server caps a batch and rejects anything past it: losing
 * the tail of a session is bad, losing all of it because of the tail is worse.
 * A session cannot realistically get near this, since it can only hold
 * decisions for stories the wire actually served.
 */
export async function migrateSessionToAccount(): Promise<boolean> {
  const session = readSession();

  if (!session || session.decisions.size === 0) {
    setPending(false);
    return true;
  }

  setPending(true);

  const entries = [...session.decisions]
    .slice(0, 500)
    .map(([storyId, state]) => ({ storyId, state }));

  const response = await mergeDesk(entries);

  if (response?.success !== true) {
    return false;
  }

  setPending(false);
  return true;
}
