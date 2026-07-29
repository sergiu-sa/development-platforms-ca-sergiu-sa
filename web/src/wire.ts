/**
 * Homepage wire feed.
 *
 * Deliberately minimal: public/ is replaced wholesale by the Vite rebuild, so
 * this is a working feed rather than a design pass.
 */

import { getWire } from "./api";
import { updateNavigation } from "./auth";
import { escapeHtml, safeUrl } from "./lib/html";
import { relativeTime } from "./lib/time";

interface Story {
  id: number;
  title: string;
  summary: string | null;
  url: string;
  section: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
}

interface WireResponse {
  success: boolean;
  stale: boolean;
  fetchedAt?: string;
  page: number;
  pageSize: number;
  total: number;
  stories: Story[];
}

function storyCard(story: Story) {
  const image = safeUrl(story.thumbnailUrl);
  const link = safeUrl(story.url);
  const title = escapeHtml(story.title);

  const thumbnail = image
    ? `<img src="${escapeHtml(image)}" alt="" loading="lazy"
           class="w-32 h-24 object-cover rounded flex-shrink-0" />`
    : "";

  const headline = link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"
          class="hover:underline">${title}</a>`
    : title;

  return `
    <article class="card flex gap-4">
      ${thumbnail}
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-xs text-gray-500 mb-1">
          <span class="uppercase tracking-wide">${escapeHtml(story.section || "News")}</span>
          <span>&middot;</span>
          <time datetime="${escapeHtml(story.publishedAt)}">${escapeHtml(relativeTime(story.publishedAt))}</time>
        </div>
        <h2 class="font-semibold text-gray-800 mb-1">${headline}</h2>
        <p class="text-sm text-gray-600">${escapeHtml(story.summary || "")}</p>
      </div>
    </article>
  `;
}

async function loadWire() {
  const container = document.getElementById("wire-container");
  const status = document.getElementById("wire-status");
  if (!container) return;

  const response: WireResponse = await getWire();

  if (!response.success) {
    container.innerHTML = `
      <p class="text-gray-500 text-center py-8">
        The wire is unavailable right now. Try again shortly.
      </p>`;
    return;
  }

  if (response.stories.length === 0) {
    container.innerHTML = `
      <p class="text-gray-500 text-center py-8">
        Nothing on the wire yet.
      </p>`;
    return;
  }

  container.innerHTML = response.stories.map(storyCard).join("");

  // Staleness is a quiet timestamp, never an error banner. Old news reads fine.
  if (status && response.stale && response.fetchedAt) {
    status.textContent = `Last updated ${relativeTime(response.fetchedAt)}`;
  }
}

export function initWire() {
  updateNavigation();
  loadWire();
}
