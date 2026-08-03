// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { renderWire, syncDecisions } from "./render";
import { createDeck, decide } from "./deck";
import { makeStory } from "./story.fixture";
import type { Story } from "./types";

const story = (over: Partial<Story> = {}) =>
  makeStory({
    title: "Half of England in drought",
    summary: "Seven regions affected",
    url: "https://theguardian.com/x",
    section: "Environment",
    publishedAt: "2026-07-29T13:02:00.000Z",
    ...over,
  });

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement("div");
});

describe("renderWire", () => {
  it("renders one item per story", () => {
    renderWire(el, {
      success: true,
      stale: false,
      stories: [story(), story({ id: 2 })],
    });
    expect(el.querySelectorAll(".wire-item").length).toBe(2);
  });

  it("escapes a headline containing markup", () => {
    renderWire(el, {
      success: true,
      stale: false,
      stories: [story({ title: '<img src=x onerror="alert(1)">' })],
    });
    expect(el.querySelector("img[onerror]")).toBeNull();
    expect(el.textContent).toContain("<img");
  });

  it("does not render a javascript: url as a link", () => {
    renderWire(el, {
      success: true,
      stale: false,
      stories: [story({ url: "javascript:alert(1)" })],
    });
    expect(el.querySelector('a[href^="javascript:"]')).toBeNull();
    // Asserting the absence of that one href is not enough: wrapping the
    // headline in an inert <a href="#"> would satisfy it while still
    // presenting unsafe content as a link. No anchor should exist at all.
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("Half of England in drought");
  });

  it("shows the designed empty state, not an error, on an empty wire", () => {
    renderWire(el, { success: true, stale: false, stories: [] });
    expect(el.textContent).toContain("The wire is quiet");
  });

  // stale is not an error - old news reads fine.
  it("renders stories normally when the wire is stale", () => {
    renderWire(el, {
      success: true,
      stale: true,
      fetchedAt: "2026-07-29T12:00:00.000Z",
      stories: [story()],
    });
    expect(el.querySelectorAll(".wire-item").length).toBe(1);
    expect(el.textContent).not.toMatch(/error|unavailable/i);
    // Checking only for the absence of alarming words would still pass if the
    // stale branch were deleted outright, which is the regression that
    // actually matters. The quiet timestamp must genuinely be present.
    const note = el.querySelector(".wire-stale");
    expect(note).not.toBeNull();
    expect(note?.textContent?.trim()).not.toBe("");
  });

  it("renders the unavailable state and no stories when the fetch fails", () => {
    renderWire(el, { success: false, stale: false, stories: [] });
    expect(el.querySelectorAll(".wire-item").length).toBe(0);
    expect(el.querySelector(".wire-empty")).not.toBeNull();
    // The unavailable and empty states share .wire-empty wrapper classes, so
    // asserting the wrapper proves nothing about which one rendered. A branch
    // that checked stories.length before success would serve "quiet" on a
    // failed fetch and still pass. Only the wording tells them apart.
    expect(el.textContent).toContain("unavailable");
    expect(el.textContent).not.toContain("The wire is quiet");
  });

  it("distinguishes a quiet wire from a failed one", () => {
    renderWire(el, { success: true, stale: false, stories: [] });
    expect(el.textContent).toContain("The wire is quiet");
    expect(el.textContent).not.toContain("unavailable");
  });

  it("always prints a machine-readable timestamp", () => {
    renderWire(el, { success: true, stale: false, stories: [story()] });
    expect(el.querySelector("time")).not.toBeNull();
  });

  it("labels each row with the same slug the deck's rails use", () => {
    renderWire(el, {
      success: true,
      stale: false,
      stories: [story({ id: 42 })],
    });
    expect(el.textContent).toContain("ENVIRONM-42");
  });

  it("writes the story id as a number, not as whatever arrived", () => {
    // The only interpolation on this page that is not escaped, so it is
    // coerced instead. A string id carrying a quote would break the attribute.
    renderWire(el, {
      success: true,
      stale: false,
      stories: [story({ id: '1" onmouseover="alert(1)' as unknown as number })],
    });

    expect(el.querySelector("[onmouseover]")).toBeNull();
    expect(el.querySelector(".wire-item")?.getAttribute("data-story-id")).toBe(
      "NaN"
    );
  });

  it("puts rows below the section heading in the outline", () => {
    // h1 "The wire" > h2 "Everything on the wire" > h3 per story.
    renderWire(el, { success: true, stale: false, stories: [story()] });
    expect(el.querySelector(".wire-item-h")?.tagName).toBe("H3");
  });
});

describe("syncDecisions", () => {
  const stories = [story({ id: 1 }), story({ id: 2 }), story({ id: 3 })];

  const paint = (decided: ReturnType<typeof createDeck>) => {
    renderWire(el, { success: true, stale: false, stories });
    syncDecisions(el, decided);
  };

  const row = (id: number) =>
    el.querySelector<HTMLElement>(`[data-story-id="${id}"]`)!;

  it("marks a saved row with a word, not only a colour", () => {
    paint(decide(createDeck(stories), 2, "saved"));

    expect(row(2).dataset.state).toBe("saved");
    // The word a reader sees, not the union member the code passes around.
    expect(row(2).querySelector(".wire-item-state")?.textContent).toBe("Saved");
  });

  it("marks a skipped row the same way", () => {
    paint(decide(createDeck(stories), 3, "skipped"));

    expect(row(3).dataset.state).toBe("skipped");
    expect(row(3).querySelector(".wire-item-state")?.textContent).toBe(
      "Skipped"
    );
  });

  it("leaves undecided rows unmarked", () => {
    paint(decide(createDeck(stories), 1, "saved"));

    expect(row(2).dataset.state).toBeUndefined();
    expect(row(2).querySelector(".wire-item-state")?.textContent).toBe("");
  });

  it("clears a row when the decision is undone", () => {
    const decided = decide(createDeck(stories), 1, "saved");
    paint(decided);
    expect(row(1).dataset.state).toBe("saved");

    syncDecisions(el, createDeck(stories));
    expect(row(1).dataset.state).toBeUndefined();
  });

  it("does not rebuild the rows", () => {
    // A re-render would drop the focus of anyone who had tabbed to a headline
    // before the deck advanced.
    paint(createDeck(stories));
    const before = row(1);

    syncDecisions(el, decide(createDeck(stories), 1, "saved"));
    expect(row(1)).toBe(before);
  });
});
