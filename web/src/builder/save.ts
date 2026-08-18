/**
 * Autosave for the builder.
 *
 * The same bargain the desk's sync makes - the screen changes immediately and this pushes it up afterwards - with one difference that decides the whole design.
 * The desk loses a decision the reader can make again in a keystroke. This loses prose somebody wrote.
 *
 * **A dirty key, never a payload.** The queue holds *which* things changed, and the request body is read out of the live state at the moment of sending.
 * That is what makes a stale write unrepresentable, and the case it closes is real:
 * queue an ordering, remove a story before it drains, and a captured payload would name an item the briefing no longer has - which the server refuses outright with "the order must list every story in this briefing exactly once".
 * Resolved at send time, the ordering is simply the current one.
 * The same argument retires "last write wins" as a thing to implement, because there is only ever one value.
 *
 * **One request at a time**, for the reason the desk drains serially: two writes to one briefing finishing out of order leave the server holding something nobody typed.
 *
 * The debounce lives here rather than in the page, because a timer in a page is a timer with no test.
 */

import {
  isFinalRefusal,
  reorderBriefingItems,
  updateBriefing,
  updateBriefingNote,
} from "../lib/api";
import { itemIds, TITLE_MIN, type BuilderState } from "./state";

/**
 * What changed. One key per thing that can be written separately, which is also one request each.
 *
 * Notes are keyed per item so editing two of them is two writes rather than one that carries both;
 * the server has no endpoint that takes both, and inventing a client-side batch over two PATCHes would only move the ordering problem.
 */
export type SaveKey = "briefing" | "order" | `item:${number}`;

export function itemKey(itemId: number): SaveKey {
  return `item:${itemId}`;
}

function itemIdFromKey(key: SaveKey): number | null {
  const match = /^item:(\d+)$/.exec(key);

  return match ? Number(match[1]) : null;
}

/**
 * Three states, and "we tried and it did not work" is deliberately not a fourth.
 *
 * A failed write leaves the key pending, so the honest thing to say is the same thing that is true before any attempt: this is not saved yet.
 * A separate alarm state would also fire for a title the curator has half-deleted, which is not a failure - it is a title that is not ready to be sent.
 */
export type SaveStatus = "saved" | "saving" | "unsaved";

export interface SaveTransport {
  /** Resolves false only when the write is worth trying again. */
  send(key: SaveKey): Promise<boolean>;
}

export interface Saver {
  /** Marks something changed. Sends after a pause. */
  touch(key: SaveKey): void;
  /** Sends now, without waiting for the pause. */
  flush(): Promise<void>;
  /** Resolves once the queue has stopped moving. */
  settled(): Promise<void>;
  status(): SaveStatus;
  pendingCount(): number;
  subscribe(listener: (status: SaveStatus) => void): () => void;
}

/** Long enough that ordinary typing does not produce a request per keystroke. */
export const SAVE_DELAY_MS = 700;

export function createSaver(
  transport: SaveTransport,
  { delay = SAVE_DELAY_MS }: { delay?: number } = {}
): Saver {
  const pending = new Set<SaveKey>();
  const listeners = new Set<(status: SaveStatus) => void>();
  let draining: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: SaveStatus = "saved";

  function setStatus(next: SaveStatus): void {
    if (next === status) return;

    status = next;
    for (const listener of listeners) listener(status);
  }

  async function drain(): Promise<void> {
    while (pending.size > 0) {
      const key: SaveKey = pending.values().next().value!;
      pending.delete(key);
      setStatus("saving");

      const sent = await transport.send(key);

      // Put a failure back and stop, unless the curator has already changed that same thing again
      // - the key is pending anyway then, and it will be sent with the newer value because the payload is read at send time.
      if (!sent && !pending.has(key)) {
        pending.add(key);
        break;
      }
    }

    draining = null;
    setStatus(pending.size === 0 ? "saved" : "unsaved");
  }

  function start(): Promise<void> {
    if (!draining && pending.size > 0) {
      draining = drain();
    }

    return draining ?? Promise.resolve();
  }

  return {
    touch(key) {
      pending.add(key);
      setStatus("unsaved");

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void start();
      }, delay);
    },

    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      return start();
    },

    settled: () => draining ?? Promise.resolve(),
    status: () => status,
    pendingCount: () => pending.size,

    subscribe(listener) {
      listeners.add(listener);
      listener(status);

      return () => listeners.delete(listener);
    },
  };
}

/**
 * Turns a dirty key into the request for it, against whatever the briefing looks like right now.
 *
 * `getState` rather than a state object, and that is the point of the module: nothing here can send a value that was true a moment ago.
 */
export function createBuilderTransport(
  getState: () => BuilderState
): SaveTransport {
  return {
    async send(key) {
      const state = getState();

      if (key === "briefing") {
        // A title below the server's minimum is not a failure, it is a title still being typed.
        // Sending it would spend a request to be told 400, and the key stays pending so the finished title goes up instead.
        if (state.title.trim().length < TITLE_MIN) return false;

        const { status, body } = await updateBriefing(state.id, {
          title: state.title.trim(),
          intro: state.intro,
        });

        return body?.success === true || isFinalRefusal(status);
      }

      if (key === "order") {
        // Nothing to order. Not a failure and not worth a request; the reorder endpoint requires at least one id and would refuse an empty list.
        if (state.items.length === 0) return true;

        const { status, body } = await reorderBriefingItems(
          state.id,
          itemIds(state.items)
        );

        return body?.success === true || isFinalRefusal(status);
      }

      const itemId = itemIdFromKey(key);
      const item = state.items.find((candidate) => candidate.id === itemId);

      // The story was removed while its note was queued.
      // There is nothing left to write it to, and reporting that as a failure would jam the queue on a request that can never succeed.
      if (!item) return true;

      const { status, body } = await updateBriefingNote(
        state.id,
        item.id,
        item.note
      );

      return body?.success === true || isFinalRefusal(status);
    },
  };
}
