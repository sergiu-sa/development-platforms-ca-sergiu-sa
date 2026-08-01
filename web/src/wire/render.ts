/**
 * The wire as a plain list: section, time, headline, trail.
 *
 * Provisional by design. The homepage becomes the deck in phase 3 and the real
 * browse row in phase 4; this keeps the page honest in between rather than
 * leaving a deployed site with a stub where its content used to be. It is built
 * from the design system's tokens, so nothing here has to be unlearned.
 *
 * The decay ramp this module used to consume is deleted. It is not coming back:
 * a continuous function reads as "a list where the first one is big", and it
 * bottomed out at 11px.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { relativeTime } from "../lib/time";

export interface Story {
  id: number;
  title: string;
  summary: string | null;
  url: string;
  section: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
}

export interface WireResponse {
  success: boolean;
  stale: boolean;
  fetchedAt?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  stories: Story[];
}

function headline(title: string, url: string | null | undefined): string {
  const text = escapeHtml(title);
  const link = safeUrl(url);
  return link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
}

function storyMarkup(story: Story, now: Date): string {
  const section = escapeHtml(story.section || "News");
  const iso = escapeHtml(story.publishedAt);
  const rel = escapeHtml(relativeTime(story.publishedAt, now));
  const summary = story.summary
    ? `<p class="wire-item-t">${escapeHtml(story.summary)}</p>`
    : "";

  return `
    <article class="wire-item">
      <div class="wire-item-meta m quiet">
        <span>${section}</span>
        <time datetime="${iso}">${rel}</time>
      </div>
      <h2 class="wire-item-h">${headline(story.title, story.url)}</h2>
      ${summary}
    </article>
  `;
}

function emptyStateMarkup(): string {
  return `
    <div class="wire-empty">
      <h2 class="wire-empty-h">The wire is quiet.</h2>
      <p class="wire-empty-s">
        Nothing has come through yet today. The clock is still running.
      </p>
    </div>
  `;
}

function unavailableMarkup(): string {
  return `
    <div class="wire-empty">
      <h2 class="wire-empty-h">The wire is unavailable.</h2>
      <p class="wire-empty-s">Try again shortly.</p>
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
