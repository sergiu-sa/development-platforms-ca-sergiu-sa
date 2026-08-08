/**
 * Composing an edition: everything the desk decides about shape, with no DOM in sight.
 *
 * The rendering lives in `desk-view.ts`.
 * This is the part worth testing, and the part a later phase will read to find out how a desk is put together.
 */

import { readingTimeMinutes } from "../lib/reading-time";
import { storyImage } from "../wire/marks";
import type { Story } from "../wire/types";
import type { DeskDecision, DeskEntry } from "./types";

/**
 * The sections of the paper, in the order a paper prints them;
 * never in the order the reader happened to save things. A section is a fixed place.
 */
export const PILLARS = ["News", "Sport", "Opinion", "Arts", "Lifestyle"];

/** Where a story with no pillar goes. The 332 rows cached before phase 1 have
 * none, and the desk has to survive one being saved. */
export const OTHER = "Other stories";

/** The local calendar day, so a save at 00:30 belongs to the day the reader
 * actually had rather than to whatever UTC thought at the time. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * A day key back to a local Date, at midnight.
 *
 * One parse, because the two facts it encodes;
 * that the key is a local calendar day, and that the month is zero-based;
 * are the details this page is most likely to get wrong, and they were being restated in three places.
 */
export function dayDate(day: string, offsetDays = 0): Date {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year, month - 1, date + offsetDays);
}

/**
 * The day an edition is being read for, taken from `?date`.
 *
 * Anything that is not a real calendar day falls back to today.
 * The shape test is not enough on its own: `2026-13-45` matches `\d{4}-\d{2}-\d{2}` and the Date constructor rolls it silently into February 2027, so the parsed date is asked whether it survived the round trip.
 */
export function dayFromQuery(search: string, now: Date = new Date()): string {
  const requested = new URLSearchParams(search).get("date");
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return dayKey(now);
  if (dayKey(dayDate(requested)) !== requested) return dayKey(now);

  // A day whose local midnight falls before the epoch is refused by the server, whose window floors there because Postgres has no year zero.
  // Left to go, it would answer 400 and the page would say the desk could not be loaded;
  // an outage message for what is really a mistyped URL.
  // Note this catches 1970-01-01 itself in every zone east of UTC, where that local midnight is 1969-12-31T23:00Z.
  if (Date.parse(dayBounds(requested).from) < 0) return dayKey(now);

  return requested;
}

/**
 * Local midnight to local midnight, as two absolute instants.
 *
 * The browser is the only party that knows what midnight means to this reader, so it does the calendar arithmetic and the server compares timestamps.
 * `to` is the next day's midnight and the server treats it as exclusive, so two consecutive editions cannot both claim the same story.
 *
 * Built from the Date constructor rather than by string arithmetic, which is what makes it correct across a daylight-saving boundary:
 * on the day a clock goes forward the two instants are 23 hours apart, not 24, and `new Date(y, m, d + 1)` knows that while `+ 86400000` does not.
 */
export function dayBounds(day: string): { from: string; to: string } {
  return {
    from: dayDate(day).toISOString(),
    to: dayDate(day, 1).toISOString(),
  };
}

export function pillarOf(story: Story): string {
  return story.pillar && PILLARS.includes(story.pillar) ? story.pillar : OTHER;
}

/**
 * Minutes to read, or null where the number would be a lie.
 *
 * Passes straight through to the shared rule, which returns null for a live blog:
 * its word count is only what has been posted so far.
 * The desk prints this on every band and sums it in the masthead, so inventing a floor here would put that lie in two more places.
 */
export function minutesOf(story: Story): number | null {
  return readingTimeMinutes(story.wordCount, story.tone);
}

/**
 * The lead: the newest save carrying a photograph, and the newest of any kind when none has one.
 *
 * Newest rather than "most important", because the desk has no importance signal and inventing one would be the editorial guess the design forbids.
 * Preferring a photograph keeps the one story drawn large from being the one with nothing to draw it with;
 * which is a real case, not a hypothetical:
 * every row cached before phase 1 has no image.
 */
export function pickLead(entries: readonly DeskEntry[]): DeskEntry | null {
  // Through the same helper the renderer draws with.
  // Testing the raw fields here let the two disagree:
  // a story whose URL is not http(s) passed this check and then drew nothing, which is the one outcome the rule exists to
  // prevent.
  return entries.find((entry) => storyImage(entry.story)) ?? entries[0] ?? null;
}

export interface EditionFacts {
  storyCount: number;
  /** Summed across the stories that have one. Live blogs contribute nothing. */
  minutes: number;
}

/**
 * The two numbers the masthead prints.
 *
 * Separate from `composeEdition` because the masthead needs only these, and asking for the whole composition meant picking a lead, allocating two arrays, grouping into a Map and sorting it;
 * on every load and again after every Remove;
 * to arrive at a count and a sum.
 */
export function editionFacts(entries: readonly DeskEntry[]): EditionFacts {
  return {
    storyCount: entries.length,
    minutes: entries.reduce(
      (total, entry) => total + (minutesOf(entry.story) ?? 0),
      0
    ),
  };
}

/**
 * How an edition is arranged.
 * Deliberately without the facts line's two numbers: `renderEdition` reads only these, and the masthead asks `editionFacts` directly, so folding them in here meant a reduce over every story on every render for a value nothing at this call site looked at.
 */
export interface Edition {
  /** Null only when the day is empty. */
  lead: DeskEntry | null;
  /** The rest, grouped into sections in pillar order. The lead is not here. */
  sections: { pillar: string; entries: DeskEntry[] }[];
}

export function composeEdition(entries: readonly DeskEntry[]): Edition {
  const lead = pickLead(entries);
  const rest = entries.filter((entry) => entry !== lead);

  const groups = new Map<string, DeskEntry[]>();
  for (const entry of rest) {
    const pillar = pillarOf(entry.story);
    const bucket = groups.get(pillar);
    if (bucket) bucket.push(entry);
    else groups.set(pillar, [entry]);
  }

  const order = [...PILLARS, OTHER];
  const sections = [...groups]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([pillar, group]) => ({ pillar, entries: group }));

  return { lead, sections };
}

export interface ArchiveDay {
  /** `YYYY-MM-DD`, local. */
  day: string;
  count: number;
  isToday: boolean;
}

/**
 * Which days have an edition, newest first.
 *
 * Built from the compact list;
 * every decision the reader has ever made, at a few dozen bytes each;
 * because the dated read only ever knows about one day and could never discover the others.
 * Skips are dropped here:
 * they are machinery for the deck, and an edition is what was kept.
 */
export function composeArchive(
  decisions: readonly DeskDecision[],
  now: Date = new Date()
): ArchiveDay[] {
  const counts = new Map<string, number>();

  for (const decision of decisions) {
    if (decision.state !== "saved") continue;
    const day = dayKey(new Date(decision.decidedAt));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const today = dayKey(now);

  return [...counts]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, count]) => ({ day, count, isToday: day === today }));
}
