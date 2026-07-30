/**
 * The wire as a continuous typographic decay field, not a list of cards.
 *
 * Every headline's size, width, weight and opacity come from `rampFor`
 * (../wire/ramp), applied via CSS custom properties so the single
 * `.wire-head` rule in styles/app.css consumes them. This module never
 * computes or adjusts those numbers itself.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { relativeTime } from "../lib/time";
import { rampFor, freshness, type Ramp } from "./ramp";

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

// Images appear only on the newest two stories - below that the page is pure
// type. Beyond this rank, stories recede into the small-type tail instead of
// the full decaying headline treatment.
const IMAGE_RANKS = 2;
const TAIL_START = 12;

function headline(title: string, url: string | null | undefined): string {
  const text = escapeHtml(title);
  const link = safeUrl(url);
  return link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
}

function storyMarkup(story: Story, rank: number, now: Date): string {
  const section = escapeHtml(story.section || "News");
  const iso = escapeHtml(story.publishedAt);
  const rel = escapeHtml(relativeTime(story.publishedAt, now));
  const image = rank < IMAGE_RANKS ? safeUrl(story.thumbnailUrl) : null;

  const thumbnail = image
    ? `<img class="wire-img" src="${escapeHtml(image)}" alt="" loading="lazy" />`
    : "";

  return `
    <article class="wire-item">
      <span class="psec">${section} &middot; <time datetime="${iso}">${rel}</time></span>
      <h2 class="wire-head">${headline(story.title, story.url)}</h2>
      ${thumbnail}
    </article>
  `;
}

function tailMarkup(story: Story, now: Date): string {
  const iso = escapeHtml(story.publishedAt);
  const rel = escapeHtml(relativeTime(story.publishedAt, now));

  return `
    <p class="wire-tail-item">
      <time datetime="${iso}">${rel}</time> ${headline(story.title, story.url)}
    </p>
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

function applyRamp(head: HTMLElement, r: Ramp, withSize: boolean): void {
  if (withSize) head.style.setProperty("--size", String(r.size));
  head.style.setProperty("--wdth", String(r.wdth));
  head.style.setProperty("--wght", String(r.wght));
  head.style.setProperty("--opacity", String(r.opacity));
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

  // Freshness is a whole-page signal derived from the newest story's real
  // age. It never touches text opacity (see ramp.ts) - only the signal
  // colour's saturation and the hairline rule alpha, both driven from this
  // custom property on <body> by styles/app.css.
  const newestMs = stories.length
    ? new Date(stories[0].publishedAt).getTime()
    : now.getTime();
  const level = stories.length ? freshness(newestMs, now.getTime()) : 0;
  document.body.style.setProperty("--freshness", String(level));

  if (!response.success) {
    container.innerHTML = unavailableMarkup();
    return;
  }

  if (stories.length === 0) {
    container.innerHTML = emptyStateMarkup();
    return;
  }

  const mainStories = stories.slice(0, TAIL_START);
  const tailStories = stories.slice(TAIL_START);

  let html = "";

  // Staleness is a quiet timestamp, never an error banner. Old news reads
  // fine, so this note sits above the stories rather than replacing them.
  if (response.stale && response.fetchedAt) {
    html += `<p class="wire-stale">Last updated ${escapeHtml(
      relativeTime(response.fetchedAt, now)
    )}</p>`;
  }

  html += mainStories
    .map((story, rank) => storyMarkup(story, rank, now))
    .join("");

  if (tailStories.length > 0) {
    html += `<div class="wire-tail">${tailStories
      .map((story) => tailMarkup(story, now))
      .join("")}</div>`;
  }

  container.innerHTML = html;

  // Set through CSS custom properties so the .wire-head / .wire-tail-item
  // rules consume them - never hardcode a per-rank value here.
  container.querySelectorAll<HTMLElement>(".wire-head").forEach((head, i) => {
    applyRamp(head, rampFor(i, stories.length), true);
  });

  container
    .querySelectorAll<HTMLElement>(".wire-tail-item")
    .forEach((item, i) => {
      applyRamp(item, rampFor(TAIL_START + i, stories.length), false);
    });
}
