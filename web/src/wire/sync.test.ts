// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDeskSync,
  createDeskTransport,
  diffDecisions,
  fetchAccountDecisions,
  migrateSessionToAccount,
  migrationPending,
  mountDeskSync,
  type DeskTransport,
  type SyncIntent,
} from "./sync";
import { createStore, STORAGE_KEY } from "./store";
import type { Decision, Story } from "./types";
import { makeStory } from "./story.fixture";

const stories: Story[] = [
  makeStory({ id: 1 }),
  makeStory({ id: 2 }),
  makeStory({ id: 3 }),
];

function decisions(
  entries: [number, Decision][]
): ReadonlyMap<number, Decision> {
  return new Map(entries);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A transport that records what it was asked to do.
 *
 * `slow` makes each request take a turn of the event loop, which is what lets
 * a test put a decision in while an earlier one is still in flight - the only
 * situation where the queue has anything to collapse.
 *
 * It also counts overlap. One request at a time is the property that stops a
 * save and its undo finishing in the wrong order, so it is worth asserting
 * directly rather than inferring from how many calls arrived.
 */
function recordingTransport(
  options: { failing?: boolean; slow?: boolean } = {}
) {
  const calls: SyncIntent[] = [];
  const succeed = !options.failing;
  let inFlight = 0;
  let mostAtOnce = 0;

  async function record(intent: SyncIntent): Promise<boolean> {
    calls.push(intent);
    inFlight += 1;
    mostAtOnce = Math.max(mostAtOnce, inFlight);

    if (options.slow) await tick();

    inFlight -= 1;
    return succeed;
  }

  const transport: DeskTransport = {
    set: (storyId, state) => record({ kind: "set", storyId, state }),
    clear: (storyId) => record({ kind: "clear", storyId }),
  };

  return { transport, calls, mostAtOnce: () => mostAtOnce };
}

describe("diffDecisions", () => {
  it("reports a new decision", () => {
    expect(diffDecisions(decisions([]), decisions([[1, "saved"]]))).toEqual([
      { kind: "set", storyId: 1, state: "saved" },
    ]);
  });

  it("reports a change of mind", () => {
    expect(
      diffDecisions(decisions([[1, "saved"]]), decisions([[1, "skipped"]]))
    ).toEqual([{ kind: "set", storyId: 1, state: "skipped" }]);
  });

  it("reports a decision taken back", () => {
    expect(diffDecisions(decisions([[1, "saved"]]), decisions([]))).toEqual([
      { kind: "clear", storyId: 1 },
    ]);
  });

  it("reports nothing when nothing moved", () => {
    const same = decisions([
      [1, "saved"],
      [2, "skipped"],
    ]);

    expect(diffDecisions(same, new Map(same))).toEqual([]);
  });

  // The one that protects the desk. createDeck filters restored decisions down
  // to the stories on the current wire page, so the store routinely knows
  // about fewer decisions than the account holds. Diffing against the server
  // instead of against the previous snapshot would read every one of those as
  // a removal and delete the reader's whole history.
  it("says nothing about stories neither snapshot mentions", () => {
    const intents = diffDecisions(
      decisions([[1, "saved"]]),
      decisions([
        [1, "saved"],
        [2, "saved"],
      ])
    );

    expect(intents).toEqual([{ kind: "set", storyId: 2, state: "saved" }]);
  });
});

describe("the sync queue", () => {
  it("sends nothing on the first observation", async () => {
    const { transport, calls } = recordingTransport();
    const sync = createDeskSync(transport);

    sync.observe(decisions([[1, "saved"]]));
    await sync.settled();

    expect(calls).toEqual([]);
  });

  it("sends a decision made after the baseline", async () => {
    const { transport, calls } = recordingTransport();
    const sync = createDeskSync(transport);

    sync.observe(decisions([]));
    sync.observe(decisions([[1, "saved"]]));
    await sync.settled();

    expect(calls).toEqual([{ kind: "set", storyId: 1, state: "saved" }]);
  });

  it("sends a removal", async () => {
    const { transport, calls } = recordingTransport();
    const sync = createDeskSync(transport);

    sync.observe(decisions([[1, "saved"]]));
    sync.observe(decisions([]));
    await sync.settled();

    expect(calls).toEqual([{ kind: "clear", storyId: 1 }]);
  });

  // Save then undo. This is the case the queue exists for: two requests about
  // one story must never be in the air together, or the delete can land first
  // and leave the story on the desk with nothing on screen saying so.
  //
  // Note what is asserted and what is not. Both requests are sent - the reader
  // really did two things - and the guarantee is that they go one at a time,
  // in order, ending on the truth. Collapsing them into a single request is an
  // optimisation, and only possible in the case below.
  it("sends a save and its undo one at a time, ending on the undo", async () => {
    const { transport, calls, mostAtOnce } = recordingTransport({ slow: true });
    const sync = createDeskSync(transport);

    sync.observe(decisions([]));
    sync.observe(decisions([[1, "saved"]]));
    sync.observe(decisions([]));
    await sync.settled();

    expect(mostAtOnce()).toBe(1);
    expect(calls).toEqual([
      { kind: "set", storyId: 1, state: "saved" },
      { kind: "clear", storyId: 1 },
    ]);
  });

  // Changes that pile up behind an in-flight request do collapse: the queue
  // holds one entry per story, so only the state it ended on is ever sent.
  it("skips intermediate states that arrive while a request is in flight", async () => {
    const { transport, calls, mostAtOnce } = recordingTransport({ slow: true });
    const sync = createDeskSync(transport);

    sync.observe(decisions([]));
    sync.observe(decisions([[1, "saved"]]));

    // The first request is now in flight. Two more changes of mind land behind
    // it. They end on a removal, which is deliberately a different kind of
    // request from the one queued before it - if the queue kept the first
    // intent rather than the newest, this would send a skip instead.
    sync.observe(decisions([[1, "skipped"]]));
    sync.observe(decisions([]));

    await sync.settled();

    expect(mostAtOnce()).toBe(1);
    expect(calls).toEqual([
      { kind: "set", storyId: 1, state: "saved" },
      { kind: "clear", storyId: 1 },
    ]);
  });

  it("sends one request per story when several are decided", async () => {
    const { transport, calls } = recordingTransport();
    const sync = createDeskSync(transport);

    sync.observe(decisions([]));
    sync.observe(decisions([[1, "saved"]]));
    sync.observe(
      decisions([
        [1, "saved"],
        [2, "skipped"],
      ])
    );
    await sync.settled();

    expect(calls).toEqual([
      { kind: "set", storyId: 1, state: "saved" },
      { kind: "set", storyId: 2, state: "skipped" },
    ]);
  });

  it("keeps a failed intent so the next decision carries it", async () => {
    const { transport, calls } = recordingTransport({ failing: true });
    const sync = createDeskSync(transport);

    sync.observe(decisions([]));
    sync.observe(decisions([[1, "saved"]]));
    await sync.settled();

    expect(calls).toHaveLength(1);
    expect(sync.pendingCount()).toBe(1);
  });

  // A failure must not resurrect a decision the reader has since changed.
  it("drops a failed intent that a newer one replaced", async () => {
    const calls: SyncIntent[] = [];
    let firstCall = true;

    const transport: DeskTransport = {
      async set(storyId, state) {
        calls.push({ kind: "set", storyId, state });
        const ok = !firstCall;
        firstCall = false;
        return ok;
      },
      async clear(storyId) {
        calls.push({ kind: "clear", storyId });
        return true;
      },
    };

    const sync = createDeskSync(transport);

    sync.observe(decisions([]));
    sync.observe(decisions([[1, "saved"]]));
    // Lands while the failing request above is still in flight.
    sync.observe(decisions([[1, "skipped"]]));
    await sync.settled();

    expect(calls).toEqual([
      { kind: "set", storyId: 1, state: "saved" },
      { kind: "set", storyId: 1, state: "skipped" },
    ]);
    expect(sync.pendingCount()).toBe(0);
  });
});

describe("mountDeskSync", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("sends a decision made through the store, but not the restored ones", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, decisions: { 1: "saved" }, dealt: 3 })
    );

    const { transport, calls } = recordingTransport();
    const store = createStore(stories);
    const sync = mountDeskSync(store, transport);

    // Story 1 was already saved when the page loaded; only story 2 is new.
    store.decide(2, "skipped");
    await sync.settled();

    expect(calls).toEqual([{ kind: "set", storyId: 2, state: "skipped" }]);
  });

  it("sends a removal made through the store", async () => {
    const { transport, calls, mostAtOnce } = recordingTransport({ slow: true });
    const store = createStore(stories);
    const sync = mountDeskSync(store, transport);

    store.decide(1, "saved");
    store.clear(1);
    await sync.settled();

    expect(mostAtOnce()).toBe(1);
    expect(calls.at(-1)).toEqual({ kind: "clear", storyId: 1 });
  });
});

describe("the real transport's view of a failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  function stubStatus(status: number, body: unknown = { success: false }) {
    window.localStorage.setItem("token", "a-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );
  }

  // A story that has aged off the wire answers 404 for ever. Retrying it would
  // block every decision queued behind it, so it is dropped.
  it("treats a 404 as sent, so it cannot block the queue", async () => {
    stubStatus(404);

    expect(await createDeskTransport().set(1, "saved")).toBe(true);
  });

  it("keeps a 500 for another try", async () => {
    stubStatus(500);

    expect(await createDeskTransport().set(1, "saved")).toBe(false);
  });

  // A 401 says the credential is wrong, not the request. Counting it as sent
  // would mark a removal done when nothing was written.
  it("does not treat a 401 as sent", async () => {
    stubStatus(401);

    expect(await createDeskTransport().clear(1)).toBe(false);
  });
});

describe("fetchAccountDecisions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  function stubDesk(status: number, body: unknown): void {
    window.localStorage.setItem("token", "a-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );
  }

  it("builds a decision map from the desk", async () => {
    stubDesk(200, {
      success: true,
      entries: [
        { storyId: 1, state: "saved" },
        { storyId: 2, state: "skipped" },
      ],
    });

    expect(await fetchAccountDecisions()).toEqual(
      new Map<number, Decision>([
        [1, "saved"],
        [2, "skipped"],
      ])
    );
  });

  // The response is turned into the state the homepage renders from, so it is
  // checked rather than trusted, exactly like a restored session.
  it("ignores entries that are not shaped like decisions", async () => {
    stubDesk(200, {
      success: true,
      entries: [
        { storyId: 1, state: "saved" },
        { storyId: "two", state: "saved" },
        { storyId: 3, state: "filed" },
        null,
        { storyId: 4.5, state: "saved" },
      ],
    });

    expect(await fetchAccountDecisions()).toEqual(
      new Map<number, Decision>([[1, "saved"]])
    );
  });

  // Null rather than an empty map, because "we could not ask" and "you have
  // saved nothing" must lead to different behaviour on the page.
  it("returns null when the desk cannot be read", async () => {
    stubDesk(500, { success: false, message: "nope" });

    expect(await fetchAccountDecisions()).toBeNull();
  });
});

describe("migrateSessionToAccount", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  function stubMerge() {
    window.localStorage.setItem("token", "a-token");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, merged: 2, dropped: 0 }), {
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends the session's decisions once", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        decisions: { 1: "saved", 2: "skipped" },
        dealt: 3,
      })
    );

    const fetchMock = stubMerge();
    await migrateSessionToAccount();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/desk");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      entries: [
        { storyId: 1, state: "saved" },
        { storyId: 2, state: "skipped" },
      ],
    });
  });

  it("does nothing when there is no session to move", async () => {
    const fetchMock = stubMerge();

    expect(await migrateSessionToAccount()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Deliberately starts with the flag raised. Asserting it is false from a
  // clean slate cannot fail, since afterEach clears sessionStorage - the only
  // version of this worth having is one where something had to lower it.
  it("lowers a stale flag when the session it referred to is gone", async () => {
    window.sessionStorage.setItem("lede.desk.migration-pending", "1");
    stubMerge();

    expect(migrationPending()).toBe(true);
    expect(await migrateSessionToAccount()).toBe(true);
    expect(migrationPending()).toBe(false);
  });

  // The failure that used to be invisible. `request` never rejects, so nothing
  // throws; the merge simply does not happen. The homepage then replaces the
  // session's decisions with the account's, and a whole session of triage
  // disappears with nothing logged and nothing on screen. The flag is what
  // survives that page load and gets the work finished.
  it("stays pending when the merge is refused", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, decisions: { 1: "saved" }, dealt: 3 })
    );
    window.localStorage.setItem("token", "a-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false }), { status: 500 })
      )
    );

    expect(await migrateSessionToAccount()).toBe(false);
    expect(migrationPending()).toBe(true);
  });

  it("clears the flag once a retry lands", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, decisions: { 1: "saved" }, dealt: 3 })
    );
    window.localStorage.setItem("token", "a-token");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false }), { status: 500 })
      )
    );
    await migrateSessionToAccount();
    expect(migrationPending()).toBe(true);

    stubMerge();
    expect(await migrateSessionToAccount()).toBe(true);
    expect(migrationPending()).toBe(false);
  });
});
