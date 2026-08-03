/**
 * The wire as a plain list, below the deck.
 *
 * Still provisional: phase 4 replaces it with the real browse row, which adds
 * per-row Save and Skip, the pillar filter, sort and the tray. What it does
 * carry already is the decision state, read from the same store the deck
 * writes - a page where saving a story in the deck leaves the list below
 * pretending nothing happened is worse than an unfinished one.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { storySlug } from "../lib/slug";
import { relativeTime } from "../lib/time";
import {
  decisionLabel,
  WIRE_QUIET_HEADING,
  WIRE_QUIET_LINE,
  WIRE_QUIET_NOTE,
  WIRE_UNAVAILABLE_HEADING,
  WIRE_UNAVAILABLE_LINE,
} from "./copy";
import { decisionFor, type DeckState } from "./deck";
import type { Story, WireResponse } from "./types";

function headline(title: string, url: string | null | undefined): string {
  const text = escapeHtml(title);
  const link = safeUrl(url);
  return link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
}

function storyMarkup(story: Story, now: Date): string {
  const slug = escapeHtml(storySlug(story.section, story.id));
  const section = escapeHtml(story.section || "News");
  const iso = escapeHtml(story.publishedAt);
  const rel = escapeHtml(relativeTime(story.publishedAt, now));
  const summary = story.summary
    ? `<p class="wire-item-t">${escapeHtml(story.summary)}</p>`
    : "";

  return `
    <article class="wire-item" data-story-id="${Number(story.id)}">
      <div class="wire-item-meta m">
        <span class="quiet">${slug}</span>
        <span class="quiet">${section}</span>
        <time class="quiet" datetime="${iso}">${rel}</time>
        <span class="wire-item-state"></span>
      </div>
      <h3 class="wire-item-h">${headline(story.title, story.url)}</h3>
      ${summary}
    </article>
  `;
}

function emptyStateMarkup(): string {
  return `
    <div class="wire-empty">
      <h3 class="wire-empty-h">${WIRE_QUIET_HEADING}</h3>
      <p class="wire-empty-s">${WIRE_QUIET_LINE} ${WIRE_QUIET_NOTE}</p>
    </div>
  `;
}

function unavailableMarkup(): string {
  return `
    <div class="wire-empty">
      <h3 class="wire-empty-h">${WIRE_UNAVAILABLE_HEADING}</h3>
      <p class="wire-empty-s">${WIRE_UNAVAILABLE_LINE}</p>
    </div>
  `;
}

/**
 * Renders the wire into `container`. Pure DOM output from a fetched
 * WireResponse - does not call the network itself.
 *
 * `stale: true` is never an error: the stories render exactly as normal, plus
 * a quiet "last updated" note. An empty story list renders the designed empty
 * state, not an error. `success: false` (a genuine fetch failure) is the only
 * case that renders an unavailable message.
 */
export function renderWire(
  container: HTMLElement,
  response: WireResponse,
  now: Date = new Date()
): void {
  const stories = response.stories ?? [];

  if (!response.success) {
    container.innerHTML = unavailableMarkup();
    return;
  }

  if (stories.length === 0) {
    container.innerHTML = emptyStateMarkup();
    return;
  }

  let html = "";

  // Staleness is a quiet timestamp, never an error banner. Old news reads
  // fine, so this note sits above the stories rather than replacing them.
  if (response.stale && response.fetchedAt) {
    html += `<p class="wire-stale m">Last updated ${escapeHtml(
      relativeTime(response.fetchedAt, now)
    )}</p>`;
  }

  html += `<div class="wire-list">${stories
    .map((story) => storyMarkup(story, now))
    .join("")}</div>`;

  container.innerHTML = html;
}

/**
 * Paints decisions onto rows that are already on screen.
 *
 * Attributes and one label rather than a re-render, because the list is redrawn
 * on every keypress otherwise - and a reader who has tabbed to a headline
 * would lose their place each time the deck advanced.
 *
 * Colour is never the only signal: the word is set here, and the CSS adds the
 * blue edge or the strike-through on top of it.
 */
export function syncDecisions(container: HTMLElement, state: DeckState): void {
  for (const row of container.querySelectorAll<HTMLElement>(
    "[data-story-id]"
  )) {
    const decision = decisionFor(state, Number(row.dataset.storyId));
    const label = row.querySelector(".wire-item-state");

    if (decision) row.dataset.state = decision;
    else delete row.dataset.state;

    if (label) label.textContent = decision ? decisionLabel(decision) : "";
  }
}
