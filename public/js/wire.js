/**
 * Homepage wire feed.
 *
 * Deliberately minimal: public/ is replaced wholesale by the Vite rebuild, so
 * this is a working feed rather than a design pass.
 */

import { getWire } from "./api.js";
import { updateNavigation } from "./auth.js";

// The textContent round-trip escapes &, < and > but leaves quotes alone, which
// is fine for text nodes and not fine for attribute values. Everything here is
// interpolated into innerHTML, some of it inside attributes, so escape quotes
// too rather than keeping two near-identical helpers.
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Only http(s) links get rendered as links. A "javascript:" URL in an href is
// script execution, and the wire's contents come from a third party.
function safeUrl(url) {
  return /^https?:\/\//i.test(url ?? "") ? url : null;
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;

  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function storyCard(story) {
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

  const response = await getWire();

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

document.addEventListener("DOMContentLoaded", () => {
  updateNavigation();
  loadWire();
});
