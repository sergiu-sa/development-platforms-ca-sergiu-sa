/**
 * A briefing builder for tests.
 * Imported only by `*.test.ts` and never by the app, so it is not part of the bundle.
 *
 * Built on `makeStory` rather than restating story fields, so a change to the wire's shape reaches these tests too instead of leaving them asserting against a shape the product no longer has.
 */

import { makeStory } from "../wire/story.fixture";
import type { Briefing, BriefingItem } from "./types";

const NOTES = [
  "The part that will still matter in a month. Everything else here is weather.",
  "Worth watching live rather than reading tomorrow, because the denials are the story.",
  "Nobody is going to write that headline, so read this one instead.",
];

export function makeItem(over: Partial<BriefingItem> = {}): BriefingItem {
  const position = over.position ?? 1;
  const storyId = over.storyId ?? position;

  return {
    id: position * 10,
    storyId,
    note: NOTES[(position - 1) % NOTES.length],
    position,
    story: makeStory({ id: storyId }),
    ...over,
  };
}

export function makeBriefing(over: Partial<Briefing> = {}): Briefing {
  const items =
    over.items ?? [1, 2, 3].map((position) => makeItem({ position }));

  return {
    id: 1,
    slug: "the-heat-and-who-pays-7f3a",
    title: "The heat, and who pays for it",
    intro: "Six stories about heat, and about who ends up paying for it.",
    status: "published",
    publishedAt: "2026-08-01T17:20:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T17:20:00.000Z",
    author: { username: "sergiu" },
    itemCount: items.length,
    ledeImageUrl: "https://media.guim.co.uk/abc/1000.jpg",
    ...over,
    items,
  };
}
