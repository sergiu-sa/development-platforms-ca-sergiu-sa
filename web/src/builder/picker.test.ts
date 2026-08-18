// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { makeStory } from "../wire/story.fixture";
import { available, PICKER_DAYS, pickerMarkup, pickerWindow } from "./picker";
import type { DeskEntry } from "../desk/types";

const NOW = new Date("2026-08-16T12:00:00Z");

function makeEntry(storyId: number, over: Partial<DeskEntry> = {}): DeskEntry {
  return {
    storyId,
    state: "saved",
    decidedAt: "2026-08-16T09:00:00Z",
    story: makeStory({ id: storyId, publishedAt: "2026-08-16T08:00:00Z" }),
    ...over,
  };
}

describe("the window it asks for", () => {
  // The server refuses a span over 31 days. Exactly 31 is legal until it crosses a daylight-saving boundary, when it becomes 31 days and an hour and starts failing twice a year on a page nobody changed.
  it("stays inside the server's cap with room for the hour daylight saving moves", () => {
    const { from, to } = pickerWindow(NOW);
    const span = new Date(to).getTime() - new Date(from).getTime();

    expect(span / 86_400_000).toBeCloseTo(PICKER_DAYS, 1);
    expect(span).toBeLessThan(31 * 86_400_000);
  });

  it("ends after today, so today's saves are in it", () => {
    const { to } = pickerWindow(NOW);

    expect(new Date(to).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("what is left to choose from", () => {
  it("leaves out the stories already in the briefing", () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];

    expect(available(entries, new Set([2])).map((e) => e.storyId)).toEqual([
      1, 3,
    ]);
  });
});

describe("the picker", () => {
  it("offers each story with a way to add it", () => {
    const markup = pickerMarkup([makeEntry(1)], new Set(), 50, NOW);

    expect(markup).toContain('data-pick="1"');
  });

  // Two empty states, because they need two different answers.
  it("says the desk is empty when nothing has been saved", () => {
    const markup = pickerMarkup([], new Set(), 50, NOW);

    expect(markup).toContain("Nothing saved in the last 30 days");
  });

  it("says so when everything on the desk is already in the briefing", () => {
    const markup = pickerMarkup([makeEntry(1)], new Set([1]), 50, NOW);

    expect(markup).toContain("already in this briefing");
  });

  it("offers no more stories than there is room for", () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];

    const markup = pickerMarkup(entries, new Set(), 2, NOW);

    expect(markup.match(/data-pick=/g)).toHaveLength(2);
  });

  // Five buttons reading "Add" are indistinguishable to anyone listening.
  it("names the story on the add control", () => {
    const markup = pickerMarkup(
      [
        makeEntry(1, {
          story: makeStory({ id: 1, title: "Carrots in crisis" }),
        }),
      ],
      new Set(),
      50,
      NOW
    );

    expect(markup).toContain("Carrots in crisis to this briefing");
  });

  it("escapes a headline carrying markup", () => {
    const markup = pickerMarkup(
      [
        makeEntry(1, {
          story: makeStory({
            id: 1,
            title: "</h3><img src=x onerror=alert(1)>",
          }),
        }),
      ],
      new Set(),
      50,
      NOW
    );

    expect(markup).not.toContain("<img src=x");
  });
});
