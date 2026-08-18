import { describe, it, expect } from "vitest";
import { makeStory } from "../wire/story.fixture";
import {
  fileRefusal,
  itemIds,
  moveItem,
  removeItem,
  roomLeft,
  unwrittenCount,
  type BuilderItem,
  type BuilderState,
} from "./state";

function makeItem(id: number, note = "A note"): BuilderItem {
  return { id, storyId: id * 100, note, story: makeStory({ id: id * 100 }) };
}

function makeState(over: Partial<BuilderState> = {}): BuilderState {
  return {
    id: 1,
    slug: "the-heat-7f3a",
    title: "The heat, and who pays for it",
    intro: "",
    status: "draft",
    items: [makeItem(1), makeItem(2), makeItem(3)],
    ...over,
  };
}

describe("moving a story", () => {
  it("swaps it with the one above", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];

    expect(itemIds(moveItem(items, 3, "up"))).toEqual([1, 3, 2]);
  });

  it("swaps it with the one below", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];

    expect(itemIds(moveItem(items, 1, "down"))).toEqual([2, 1, 3]);
  });

  it("promotes a story to the lede by moving it first, with no flag involved", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];

    const promoted = moveItem(moveItem(items, 3, "up"), 3, "up");

    expect(itemIds(promoted)).toEqual([3, 1, 2]);
  });

  // The caller decides whether to save by comparing references, so a move that cannot happen has to return the array it was given rather than a copy of it.
  // Otherwise every press of a control at the end of the list queues a write.
  it("returns the same array when the story is already at the top", () => {
    const items = [makeItem(1), makeItem(2)];

    expect(moveItem(items, 1, "up")).toBe(items);
  });

  it("returns the same array when the story is already at the bottom", () => {
    const items = [makeItem(1), makeItem(2)];

    expect(moveItem(items, 2, "down")).toBe(items);
  });

  it("returns the same array for a story that is not in the briefing", () => {
    const items = [makeItem(1), makeItem(2)];

    expect(moveItem(items, 99, "up")).toBe(items);
  });

  it("does not mutate the array it was given", () => {
    const items = Object.freeze([makeItem(1), makeItem(2)]);

    expect(() => moveItem(items, 2, "up")).not.toThrow();
    expect(itemIds(items)).toEqual([1, 2]);
  });
});

describe("removing a story", () => {
  it("takes it out and leaves the rest in order", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];

    expect(itemIds(removeItem(items, 2))).toEqual([1, 3]);
  });

  it("returns the same array when the story was not there", () => {
    const items = [makeItem(1)];

    expect(removeItem(items, 99)).toBe(items);
  });

  it("leaves the next story as the lede when the lede is removed", () => {
    const items = [makeItem(1), makeItem(2)];

    expect(itemIds(removeItem(items, 1))[0]).toBe(2);
  });
});

describe("whether it can be filed", () => {
  it("says nothing when it has a title and a story", () => {
    expect(fileRefusal(makeState())).toBeNull();
  });

  it("names both when it has neither", () => {
    const refusal = fileRefusal(makeState({ title: "", items: [] }));

    expect(refusal).toBe("Needs a title and one story");
  });

  it("names only the title when that is all that is missing", () => {
    expect(fileRefusal(makeState({ title: "" }))).toBe("Needs a title");
  });

  it("names only the story when that is all that is missing", () => {
    expect(fileRefusal(makeState({ items: [] }))).toBe("Needs one story");
  });

  // The server trims before it measures, so a title of spaces is no title.
  // Checked here because the two have to agree: a client that accepted it would send a request it had already promised would work.
  it("does not count a title of nothing but spaces", () => {
    expect(fileRefusal(makeState({ title: "   " }))).toBe("Needs a title");
  });

  it("does not count a title shorter than the server's minimum", () => {
    expect(fileRefusal(makeState({ title: "Hi" }))).toBe("Needs a title");
  });

  // It stays short because it lives in a fixed-height bar, where the rule is that labels shorten rather than wrap.
  it("stays short enough for the bar it sits in", () => {
    const longest = fileRefusal(makeState({ title: "", items: [] }))!;

    expect(longest.length).toBeLessThanOrEqual(32);
  });
});

describe("what the page tells the curator about the briefing", () => {
  it("counts the stories nobody has written about yet", () => {
    const state = makeState({
      items: [makeItem(1, "Written"), makeItem(2, ""), makeItem(3, "   ")],
    });

    expect(unwrittenCount(state)).toBe(2);
  });

  it("counts the room left against the server's cap", () => {
    expect(roomLeft(makeState())).toBe(47);
    expect(roomLeft(makeState({ items: [] }))).toBe(50);
  });
});
