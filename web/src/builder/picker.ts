/**
 * Choosing stories off your desk to put in a briefing.
 *
 * **The window is not a preference, it is the shape of the endpoint.** `GET /api/desk` in its full form requires `from` and `to` and refuses a span over 31 days, which is the bound phase 7 added to stop "every story body this reader has ever saved" being expressible.
 * So "everything on my desk" cannot be asked for, and the picker is window-scoped by construction rather than by choice.
 *
 * Thirty days rather than the cap of thirty-one, deliberately.
 * A span of exactly the maximum crossing a daylight-saving boundary is thirty-one days *and an hour*, which the server rejects - and it would do it twice a year, on a page that worked when it was written.
 */

import { escapeHtml } from "../lib/html";
import { getDeskEdition } from "../lib/api";
import { dayDate, dayKey } from "../desk/edition";
import { factsLine, storyImage } from "../wire/marks";
import { BUILDER_COPY as COPY } from "./copy";
import type { DeskEntry } from "../desk/types";

/** Comfortably inside the server's 31, with room for the hour daylight saving moves. */
export const PICKER_DAYS = 30;

/** The window to ask for: the last thirty days, in the reader's own timezone, as two absolute instants. */
export function pickerWindow(now: Date): { from: string; to: string } {
  const today = dayKey(now);

  return {
    from: dayDate(today, -(PICKER_DAYS - 1)).toISOString(),
    to: dayDate(today, 1).toISOString(),
  };
}

/**
 * The saved stories on the desk, or null when we could not ask.
 *
 * Null rather than an empty list, for the reason the homepage's hydration draws the same distinction: "you have saved nothing" and "we could not reach the server" must not look the same on screen.
 */
export async function loadDeskStories(
  now: Date = new Date()
): Promise<DeskEntry[] | null> {
  const { from, to } = pickerWindow(now);
  const response = await getDeskEdition(from, to);

  if (!response?.success || !Array.isArray(response.entries)) return null;

  return response.entries as DeskEntry[];
}

/** What is left to choose from once the briefing's own stories are taken out. */
export function available(
  entries: readonly DeskEntry[],
  inBriefing: ReadonlySet<number>
): DeskEntry[] {
  return entries.filter((entry) => !inBriefing.has(entry.storyId));
}

/**
 * `entries` is null when the desk could not be read at all.
 *
 * All three empty states belong together: "we could not ask", "you have saved nothing" and "it is all in here already" need three different answers, and the page had been writing the first one itself in markup no test could see.
 */
export function pickerMarkup(
  entries: readonly DeskEntry[] | null,
  inBriefing: ReadonlySet<number>,
  roomLeft: number,
  now: Date
): string {
  const heading =
    `<div class="build-picker-head">` +
    `<h2 class="build-picker-title m">From your desk</h2>` +
    `<button type="button" class="m build-picker-close" data-picker-close>Close</button>` +
    `</div>`;

  if (entries === null) {
    return `${heading}<p class="build-picker-empty">${COPY.loadFailed}</p>`;
  }

  const choices = available(entries, inBriefing);

  if (choices.length === 0) {
    // Two different empty states, because they need two different answers: one says go and save something, the other says you already have.
    const line =
      entries.length === 0
        ? "Nothing saved in the last 30 days. Anything you keep off the wire turns up here."
        : "Every story on your desk is already in this briefing.";

    return `${heading}<p class="build-picker-empty">${line}</p>`;
  }

  const rows = choices
    .slice(0, roomLeft)
    .map((entry) => {
      const image = storyImage(entry.story);

      return (
        `<li class="build-picker-row">` +
        (image
          ? `<img class="build-picker-thumb" src="${escapeHtml(image)}" alt="" loading="lazy" />`
          : `<span class="build-picker-thumb"></span>`) +
        `<div class="build-picker-story">` +
        `<h3 class="build-picker-headline">${escapeHtml(entry.story.title)}</h3>` +
        `<div class="facts m">${factsLine(entry.story, entry.story.section, now)}</div>` +
        `</div>` +
        `<button type="button" class="m chip mini-save build-picker-add" data-pick="${entry.storyId}">` +
        `Add<span class="sr-only"> ${escapeHtml(entry.story.title)} to this briefing</span>` +
        `</button>` +
        `</li>`
      );
    })
    .join("");

  return `${heading}<ul class="build-picker-list">${rows}</ul>`;
}
