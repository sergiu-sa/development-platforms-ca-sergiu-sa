import "../styles/app.css";
import { loadBriefing } from "../briefing/data";
import { isLoggedIn } from "../lib/auth";
import { clampIndex, hashForIndex, indexFromHash } from "../briefing/state";
import {
  draftBandMarkup,
  emptyMarkup,
  errorMarkup,
  indexMarkup,
  notFoundMarkup,
  stageMarkup,
} from "../briefing/view";
import type { Briefing } from "../briefing/types";

/**
 * The slug this page is for.
 *
 * `/b/<slug>` in production, where vercel.json rewrites the pretty path to the route that generates the document.
 * `?slug=` is the development fallback, so b.html can be opened directly without the rewrite Vite does not have.
 */
function slugFromLocation(): string {
  const fromPath = /^\/b\/([^/?#]+)/.exec(window.location.pathname);
  if (fromPath) return decodeURIComponent(fromPath[1]);

  return new URLSearchParams(window.location.search).get("slug") ?? "";
}

function render(root: HTMLElement, briefing: Briefing): void {
  const count = briefing.items.length;
  let current = indexFromHash(window.location.hash, count);

  const draft = briefing.status === "draft" ? draftBandMarkup() : "";

  // The index comes first in the document and is placed on the right by the grid.
  // Two reasons, and neither is visual:
  // the briefing's title is the h1 and a story headline is an h2, so source order this way round gives a sensible heading outline instead of an h2 before the h1;
  //  and somebody listening should hear what this briefing is before its first story.
  root.innerHTML =
    draft +
    `<div class="briefing">` +
    `<aside class="briefing-index">${indexMarkup(briefing, current)}</aside>` +
    // aria-live because the story changes without navigating anywhere, so a screen reader would otherwise be told nothing at all.
    `<main class="briefing-stage" id="briefing-stage" aria-live="polite">` +
    stageMarkup(briefing.items[current], current) +
    `</main>` +
    `</div>`;

  const stage = root.querySelector<HTMLElement>("#briefing-stage");
  const entries = [...root.querySelectorAll<HTMLElement>(".briefing-entry")];
  if (!stage) return;

  /**
   * Move to a story.
   *
   * Only the stage is repainted.
   * The index keeps its nodes, because redrawing it would throw away the focus of anyone who had tabbed into it;
   * the same rule the browse list follows;
   * and `aria-current` is toggled on the buttons that are already there.
   */
  function show(next: number): void {
    const target = clampIndex(next, count);
    if (target === current) return;

    const previous = current;
    current = target;
    stage!.innerHTML = stageMarkup(briefing.items[current], current);

    // Only the two that changed.
    // Writing the attribute on all of them invalidates style for every entry's subtree, and `aria-current` is a styled selector here.
    entries[previous]?.setAttribute("aria-current", "false");
    entries[current]?.setAttribute("aria-current", "true");

    // replaceState rather than pushState: moving through a briefing is reading, not navigating, and filling the back button with six entries would make Back mean "the story before" instead of "the page before".
    window.history.replaceState(null, "", hashForIndex(current));
  }

  root.addEventListener("click", (event) => {
    const entry = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-go]"
    );
    if (entry) show(Number(entry.dataset.go));
  });

  document.addEventListener("keydown", (event) => {
    // `repeat` is filtered because auto-repeat fires at about 30Hz:
    // holding the key would run the whole briefing past the reader.
    // The deck learned this.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "ArrowRight") show(current + 1);
    else if (event.key === "ArrowLeft") show(current - 1);
    else return;

    event.preventDefault();
  });
}

async function mount(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;

  const slug = slugFromLocation();
  const here = window.location.pathname + window.location.search;
  // lib/auth.ts owns the token.
  // Reading localStorage here would put the key in a third module, and moving it would leave this page quietly serving the anonymous copy to the signed-in author the branch exists for.
  const hasToken = isLoggedIn();

  // No guard on an empty slug here: the briefing may already be in the page, and it is `loadBriefing` that knows whether it needs one.
  const { briefing, status } = await loadBriefing(slug, document);

  // Not found and could-not-ask are different pages.
  // A 404 is the answer a stranger gets for somebody else's draft as well as for an address that never existed, and it is designed rather than broken.
  if (!briefing) {
    root.innerHTML =
      status === 0 ? errorMarkup() : notFoundMarkup(hasToken, here);
    return;
  }

  // Only a draft can be empty: publishing already requires at least one story.
  if (briefing.items.length === 0) {
    root.innerHTML = emptyMarkup();
    return;
  }

  document.title = `${briefing.title} - Lede`;
  render(root, briefing);
}

void mount();
