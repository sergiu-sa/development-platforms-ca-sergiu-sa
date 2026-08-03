/**
 * A story builder for tests. Imported only by `*.test.ts` and never by the
 * app, so it is not part of the bundle.
 *
 * Every field the wire serves is filled in, because the interesting cases are
 * the ones where a field is missing - and a factory that defaults things to
 * null hides them instead of making a test say so.
 */

import type { Story } from "./types";

export function makeStory(over: Partial<Story> = {}): Story {
  const id = over.id ?? 1;

  return {
    id,
    title: `Story ${id}`,
    summary: "A trail text.",
    standfirst: "The editorial subhead.",
    byline: "A Reporter",
    url: `https://www.theguardian.com/story-${id}`,
    section: "Sport",
    pillar: "Sport",
    tone: "news",
    wordCount: 460,
    starRating: null,
    thumbnailUrl: "https://media.guim.co.uk/abc/500.jpg",
    imageUrl: "https://media.guim.co.uk/abc/1000.jpg",
    imageAlt: "Two riders neck and neck at full gallop",
    imageCredit: "Photograph: Andrew Matthews/PA",
    publishedAt: "2026-08-01T13:00:00.000Z",
    ...over,
  };
}

export function makeStories(count: number): Story[] {
  return Array.from({ length: count }, (_, i) => makeStory({ id: i + 1 }));
}
