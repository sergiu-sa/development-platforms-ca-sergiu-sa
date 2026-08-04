import { describe, it, expect } from "vitest";
import { DEFAULT_VIEW, pillarsOf, visibleStories } from "./view";
import { makeStory } from "./story.fixture";
import type { Decision, Story } from "./types";
import type { ViewState } from "./view";

/**
 * A wire in the order the API serves it - `published_at DESC` - because that
 * order is what "newest" means here, and half these tests are about whether it
 * survives.
 */
const WIRE: Story[] = [
  makeStory({
    id: 1,
    pillar: "Sport",
    publishedAt: "2026-08-01T15:00:00.000Z",
  }),
  makeStory({ id: 2, pillar: "News", publishedAt: "2026-08-01T14:00:00.000Z" }),
  makeStory({
    id: 3,
    pillar: "Sport",
    publishedAt: "2026-08-01T13:00:00.000Z",
  }),
  makeStory({ id: 4, pillar: null, publishedAt: "2026-08-01T12:00:00.000Z" }),
  makeStory({
    id: 5,
    pillar: "Opinion",
    publishedAt: "2026-08-01T11:00:00.000Z",
  }),
];

const view = (over: Partial<ViewState> = {}): ViewState => ({
  ...DEFAULT_VIEW,
  ...over,
});

const decided = (pairs: [number, Decision][]) =>
  new Map<number, Decision>(pairs);

const none = new Map<number, Decision>();

const ids = (stories: readonly Story[]) => stories.map((story) => story.id);

describe("pillarsOf", () => {
  it("lists each pillar once, in alphabetical order", () => {
    expect(pillarsOf(WIRE)).toEqual(["News", "Opinion", "Sport"]);
  });

  it("leaves out stories with no pillar rather than offering a blank chip", () => {
    expect(pillarsOf([makeStory({ id: 1, pillar: null })])).toEqual([]);
  });

  it("offers nothing for an empty wire", () => {
    expect(pillarsOf([])).toEqual([]);
  });
});

describe("visibleStories", () => {
  it("shows the whole wire, in its own order, by default", () => {
    expect(ids(visibleStories(WIRE, none, DEFAULT_VIEW))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("narrows to one pillar", () => {
    expect(ids(visibleStories(WIRE, none, view({ pillar: "Sport" })))).toEqual([
      1, 3,
    ]);
  });

  it("keeps a story with no pillar out of every filter but Everything", () => {
    // It cannot be filed under a pillar it does not have, and inventing one
    // would put it under a chip that lies. Everything still reaches it.
    for (const pillar of pillarsOf(WIRE)) {
      expect(ids(visibleStories(WIRE, none, view({ pillar })))).not.toContain(
        4
      );
    }

    expect(ids(visibleStories(WIRE, none, DEFAULT_VIEW))).toContain(4);
  });

  it("hides decided stories when asked, whatever the decision was", () => {
    const decisions = decided([
      [1, "saved"],
      [4, "skipped"],
    ]);

    expect(
      ids(visibleStories(WIRE, decisions, view({ hideDecided: true })))
    ).toEqual([2, 3, 5]);
  });

  it("applies the filter and hide-decided together", () => {
    const decisions = decided([[1, "saved"]]);

    expect(
      ids(
        visibleStories(
          WIRE,
          decisions,
          view({ pillar: "Sport", hideDecided: true })
        )
      )
    ).toEqual([3]);
  });

  it("groups by pillar and keeps the wire's order inside each one", () => {
    // Sorting on the pillar alone is enough: Array.prototype.sort is stable,
    // so stories that tie keep the order they arrived in, which is already
    // newest-first. Comparing dates as a tie-break would be a second, silent
    // copy of that rule.
    expect(ids(visibleStories(WIRE, none, view({ sort: "pillar" })))).toEqual([
      2, 5, 1, 3, 4,
    ]);
  });

  it("sorts a story with no pillar to the end rather than the front", () => {
    const sorted = visibleStories(WIRE, none, view({ sort: "pillar" }));
    expect(sorted[sorted.length - 1].id).toBe(4);
  });

  it("never reorders the array it was given", () => {
    // The deck reads the same array and derives its cursor from position, so
    // an in-place sort here would move the deck's stories underneath it while
    // `decisions` still keys the old ones. Frozen so the attempt throws rather
    // than passing quietly.
    const frozen = Object.freeze([...WIRE]);

    expect(ids(visibleStories(frozen, none, view({ sort: "pillar" })))).toEqual(
      [2, 5, 1, 3, 4]
    );
    expect(ids(frozen)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns nothing when a filter matches nothing", () => {
    expect(visibleStories(WIRE, none, view({ pillar: "Lifestyle" }))).toEqual(
      []
    );
  });

  it("returns nothing for an empty wire", () => {
    expect(visibleStories([], none, DEFAULT_VIEW)).toEqual([]);
  });
});
