// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore, readSession, STORAGE_KEY } from "./store";
import {
  counts,
  dealtCount,
  decisionFor,
  nextBatchSize,
  undealt,
  BATCH_SIZE,
} from "./deck";
import { makeStories } from "./story.fixture";

const stored = () => JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!);

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistence", () => {
  it("writes decisions and the dealt batch under a versioned key", () => {
    const store = createStore(makeStories(20));
    store.decideCurrent("saved");

    expect(stored()).toEqual({
      v: 1,
      decisions: { "1": "saved" },
      dealt: BATCH_SIZE,
    });
  });

  it("restores a session into a new store", () => {
    const first = createStore(makeStories(20));
    first.decideCurrent("saved");
    first.decideCurrent("skipped");
    first.dealMore();

    const second = createStore(makeStories(20));
    expect(decisionFor(second.get(), 1)).toBe("saved");
    expect(decisionFor(second.get(), 2)).toBe("skipped");
    expect(second.get().dealt).toBe(20);
  });

  it("ignores stored decisions for stories no longer on the wire", () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        decisions: { "1": "saved", "99": "saved" },
        dealt: 12,
      })
    );

    const store = createStore(makeStories(3));
    expect(counts(store.get())).toEqual({ saved: 1, skipped: 0 });
  });

  it("does not write when nothing changed", () => {
    // Comparing the stored string proves nothing: re-serialising unchanged
    // state produces an identical string, so the old version of this test
    // passed with the no-op guard deleted. Count the writes instead.
    const store = createStore(makeStories(1));
    store.decideCurrent("saved");

    const writes = vi.spyOn(window.sessionStorage, "setItem");
    try {
      store.decideCurrent("skipped"); // past the end
      store.decide(999, "saved"); // not on the wire
      store.dealMore(); // nothing left to deal

      expect(writes).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
    }
  });
});

describe("a stored value that cannot be trusted", () => {
  const rejects = (raw: string) => {
    window.sessionStorage.setItem(STORAGE_KEY, raw);
    expect(readSession()).toBeNull();
  };

  it("rejects text that is not JSON", () => {
    rejects("not json at all");
  });

  it("rejects JSON that is not an object", () => {
    rejects('"a string"');
    rejects("null");
  });

  it("rejects a different version", () => {
    rejects(JSON.stringify({ v: 99, decisions: {}, dealt: 12 }));
  });

  it("drops decision values it does not recognise", () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        decisions: { "1": "saved", "2": "deleted", "3": 7, notanid: "saved" },
        dealt: 12,
      })
    );

    expect([...readSession()!.decisions]).toEqual([[1, "saved"]]);
  });

  it("falls back to no batch when dealt is not a whole, positive number", () => {
    // A fraction is the interesting one: Number.isFinite lets 12.5 through,
    // and it then propagates into every derived figure - the deck walks 13
    // stories while the gauge draws 12 ticks, and the panel offers
    // "Next 7.5 stories".
    for (const dealt of ["twelve", 12.5, -3, NaN, Infinity, null]) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, decisions: {}, dealt })
      );

      expect(readSession()!.dealt, `dealt: ${String(dealt)}`).toBe(0);
    }
  });

  it("never lets a hostile batch size reach a rendered number", () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, decisions: {}, dealt: 12.5 })
    );

    const state = createStore(makeStories(20)).get();
    expect(Number.isInteger(dealtCount(state))).toBe(true);
    expect(Number.isInteger(undealt(state))).toBe(true);
    expect(Number.isInteger(nextBatchSize(state))).toBe(true);
  });

  it("starts a clean deck rather than throwing on load", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "{{{");

    const store = createStore(makeStories(20));
    expect(counts(store.get())).toEqual({ saved: 0, skipped: 0 });
    expect(store.get().dealt).toBe(BATCH_SIZE);
  });
});

describe("storage that refuses to work", () => {
  /**
   * Spies are restored by hand rather than by `vi.restoreAllMocks()`. These
   * are spies on the `sessionStorage` instance, not on `Storage.prototype`,
   * because happy-dom does not route the instance through the prototype - and
   * `restoreAllMocks` does not put an instance spy back, so a throwing
   * `setItem` would leak into every test that ran afterwards.
   */
  const breaking = (method: "getItem" | "setItem") => {
    // Typed against getItem: its `string | null` return accepts the `never` of
    // a thrower, where the union of both signatures does not.
    const spy = vi.spyOn(window.sessionStorage, method as "getItem");
    spy.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    return () => spy.mockRestore();
  };

  it("keeps deciding when writing throws", () => {
    // Safari in private mode, or a full quota.
    const restore = breaking("setItem");

    try {
      const store = createStore(makeStories(3));
      expect(() => store.decideCurrent("saved")).not.toThrow();
      expect(decisionFor(store.get(), 1)).toBe("saved");
    } finally {
      restore();
    }
  });

  it("starts a clean deck when reading throws", () => {
    const restore = breaking("getItem");

    try {
      expect(readSession()).toBeNull();
      expect(() => createStore(makeStories(3))).not.toThrow();
    } finally {
      restore();
    }
  });

  it("leaves storage working for the tests that follow", () => {
    const store = createStore(makeStories(3));
    store.decideCurrent("saved");

    expect(stored().decisions).toEqual({ "1": "saved" });
  });
});

describe("subscribers", () => {
  it("calls a new subscriber immediately", () => {
    const store = createStore(makeStories(3));
    const seen = vi.fn();

    store.subscribe(seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("notifies every subscriber on a change", () => {
    // The deck and the browse list are two subscribers to one state, which is
    // what stops them disagreeing about what the reader has done.
    const store = createStore(makeStories(3));
    const deck = vi.fn();
    const list = vi.fn();

    store.subscribe(deck);
    store.subscribe(list);
    store.decideCurrent("saved");

    expect(deck).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(decisionFor(list.mock.lastCall![0], 1)).toBe("saved");
  });

  it("does not notify on a no-op", () => {
    const store = createStore(makeStories(1));
    store.decideCurrent("saved");

    const seen = vi.fn();
    store.subscribe(seen);
    store.undo();
    store.undo(); // nothing left to undo

    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore(makeStories(3));
    const seen = vi.fn();

    const off = store.subscribe(seen);
    off();
    store.decideCurrent("saved");

    expect(seen).toHaveBeenCalledTimes(1);
  });
});
