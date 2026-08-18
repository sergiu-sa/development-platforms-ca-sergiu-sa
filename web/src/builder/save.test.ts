// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeStory } from "../wire/story.fixture";
import {
  createBuilderTransport,
  createSaver,
  itemKey,
  type SaveKey,
  type SaveTransport,
} from "./save";
import type { BuilderItem, BuilderState } from "./state";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeItem(id: number, note = "A note"): BuilderItem {
  return { id, storyId: id * 100, note, story: makeStory({ id: id * 100 }) };
}

function makeState(over: Partial<BuilderState> = {}): BuilderState {
  return {
    id: 7,
    slug: "the-heat-7f3a",
    title: "The heat, and who pays for it",
    intro: "How it starts.",
    status: "draft",
    items: [makeItem(1), makeItem(2)],
    ...over,
  };
}

/**
 * A transport that records what it was asked to send.
 *
 * `slow` makes each send take a turn of the event loop, which is the only way to have a second change arrive while the first is still in flight; and that is the situation the queue exists for.
 */
function recordingTransport({
  slow = false,
  answer = () => true,
}: { slow?: boolean; answer?: (key: SaveKey) => boolean } = {}) {
  const sent: SaveKey[] = [];
  let inFlight = 0;
  let overlapped = false;

  const transport: SaveTransport = {
    async send(key) {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;

      if (slow) await tick();

      sent.push(key);
      inFlight -= 1;

      return answer(key);
    },
  };

  return { transport, sent, overlapped: () => overlapped };
}

describe("the save queue", () => {
  it("sends nothing until the pause is over", async () => {
    const { transport, sent } = recordingTransport();
    const saver = createSaver(transport, { delay: 5 });

    saver.touch("briefing");
    await tick();

    expect(sent).toEqual([]);
    expect(saver.status()).toBe("unsaved");
  });

  it("sends on flush without waiting for the pause", async () => {
    const { transport, sent } = recordingTransport();
    const saver = createSaver(transport, { delay: 10_000 });

    saver.touch("briefing");
    await saver.flush();

    expect(sent).toEqual(["briefing"]);
    expect(saver.status()).toBe("saved");
  });

  // Typing a note is one change to one thing however many keystrokes it took.
  it("collapses repeated changes to one thing into a single request", async () => {
    const { transport, sent } = recordingTransport();
    const saver = createSaver(transport, { delay: 10_000 });

    saver.touch(itemKey(1));
    saver.touch(itemKey(1));
    saver.touch(itemKey(1));
    await saver.flush();

    expect(sent).toEqual(["item:1"]);
  });

  it("sends each thing that changed", async () => {
    const { transport, sent } = recordingTransport();
    const saver = createSaver(transport, { delay: 10_000 });

    saver.touch("briefing");
    saver.touch(itemKey(1));
    saver.touch("order");
    await saver.flush();
    await saver.settled();

    expect([...sent].sort()).toEqual(["briefing", "item:1", "order"]);
  });

  // Two writes to one briefing finishing out of order leave the server holding something nobody typed, so they must never be in flight together.
  it("never has two requests in flight at once", async () => {
    const { transport, sent, overlapped } = recordingTransport({ slow: true });
    const saver = createSaver(transport, { delay: 10_000 });

    saver.touch("briefing");
    saver.touch(itemKey(1));
    saver.touch(itemKey(2));
    await saver.flush();
    await saver.settled();

    expect(sent).toHaveLength(3);
    expect(overlapped()).toBe(false);
  });

  it("keeps a failed write pending and sends it again on the next flush", async () => {
    let answer = false;
    const { transport, sent } = recordingTransport({ answer: () => answer });
    const saver = createSaver(transport, { delay: 10_000 });

    saver.touch("briefing");
    await saver.flush();
    await saver.settled();

    expect(sent).toEqual(["briefing"]);
    expect(saver.pendingCount()).toBe(1);
    expect(saver.status()).toBe("unsaved");

    answer = true;
    await saver.flush();
    await saver.settled();

    expect(sent).toEqual(["briefing", "briefing"]);
    expect(saver.pendingCount()).toBe(0);
    expect(saver.status()).toBe("saved");
  });

  // A note whose story was removed can never be written. Holding it would stop everything queued behind it, which is the failure the desk's queue records.
  it("does not let one write that can never succeed block the rest", async () => {
    const { transport, sent } = recordingTransport({
      answer: (key) => key !== "item:1",
    });
    const saver = createSaver(transport, { delay: 10_000 });

    saver.touch(itemKey(1));
    saver.touch("order");
    await saver.flush();
    await saver.settled();
    await saver.flush();
    await saver.settled();

    expect(sent).toContain("order");
  });

  it("tells a subscriber the status as it changes", async () => {
    const { transport } = recordingTransport();
    const saver = createSaver(transport, { delay: 10_000 });
    const seen: string[] = [];

    saver.subscribe((status) => seen.push(status));
    saver.touch("briefing");
    await saver.flush();

    expect(seen).toEqual(["saved", "unsaved", "saving", "saved"]);
  });
});

describe("what the transport actually sends", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function stubFetch(status = 200, body: unknown = { success: true }) {
    const fetchMock = vi.fn(async () => ({
      status,
      json: async () => body,
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
    const [, init] = fetchMock.mock.calls[call] as unknown as [
      string,
      RequestInit,
    ];

    return JSON.parse(init.body as string);
  }

  /**
   * The reason the queue holds keys rather than payloads. Queue a change, alter the briefing before it drains, and what goes up is the briefing as it is now - not as it was when the key was marked dirty.
   */
  it("reads the value at the moment of sending, not when it was queued", async () => {
    let state = makeState({ title: "First title" });
    const fetchMock = stubFetch();
    const saver = createSaver(
      createBuilderTransport(() => state),
      {
        delay: 10_000,
      }
    );

    saver.touch("briefing");
    state = makeState({ title: "The title it ended up with" });
    await saver.flush();
    await saver.settled();

    expect(bodyOf(fetchMock).title).toBe("The title it ended up with");
  });

  /**
   * The ordering is stated in full and has to be exactly the briefing's current items, so a payload captured before a removal would be refused outright.
   */
  it("sends the ordering as it stands when it drains", async () => {
    let state = makeState();
    const fetchMock = stubFetch();
    const saver = createSaver(
      createBuilderTransport(() => state),
      {
        delay: 10_000,
      }
    );

    saver.touch("order");
    state = makeState({ items: [makeItem(2)] });
    await saver.flush();
    await saver.settled();

    expect(bodyOf(fetchMock).itemIds).toEqual([2]);
  });

  it("sends a note even when it is empty, because absent would mean something else", async () => {
    const state = makeState({ items: [makeItem(1, "")] });
    const fetchMock = stubFetch();
    const transport = createBuilderTransport(() => state);

    await transport.send(itemKey(1));

    expect(bodyOf(fetchMock)).toEqual({ note: "" });
  });

  it("does not spend a request on a title the server would refuse", async () => {
    const state = makeState({ title: "Hi" });
    const fetchMock = stubFetch();
    const transport = createBuilderTransport(() => state);

    expect(await transport.send("briefing")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a note for a removed story as nothing left to do", async () => {
    const state = makeState({ items: [makeItem(2)] });
    const fetchMock = stubFetch();
    const transport = createBuilderTransport(() => state);

    expect(await transport.send(itemKey(1))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a write the server refused outright", async () => {
    const state = makeState();
    stubFetch(404, { success: false });
    const transport = createBuilderTransport(() => state);

    expect(await transport.send(itemKey(1))).toBe(true);
  });

  // 401 is a statement about the credential, not about the request.
  // Calling it final would mark the write sent when nothing was written.
  it("keeps a write that failed on an expired session", async () => {
    const state = makeState();
    localStorage.setItem("token", "a.b.c");
    stubFetch(401, { success: false });
    const transport = createBuilderTransport(() => state);

    expect(await transport.send(itemKey(1))).toBe(false);
  });

  it("keeps a write that never reached the server", async () => {
    const state = makeState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const transport = createBuilderTransport(() => state);

    expect(await transport.send("order")).toBe(false);
  });
});
