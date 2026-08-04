/**
 * One row of the browse list: everything on the wire, in full, with its own
 * Save, Skip and Read.
 *
 * The headline is text rather than a link. The row already carries three
 * labelled actions, and making the headline a fourth target to the same place
 * as Read would give a keyboard reader two stops that do the same thing while
 * hiding which one is the action.
 *
 * Every field goes through `escapeHtml`, and both URLs through `safeUrl` on
 * top of it: the wire is third-party content, and escaping stops an attribute
 * breaking out while saying nothing about the scheme.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { storySlug } from "../lib/slug";
import { decisionLabel } from "./copy";
import { factParts, guardianLink, needsByLabel } from "./marks";
import type { Decision, Story } from "./types";

export interface RowState {
  decision: Decision | null;
  /** True for the one story the deck is holding. */
  onDeck: boolean;
}

/**
 * The word in the row's corner.
 *
 * Four states, all named, because colour is never the only signal: the blue
 * edge and the strike-through are the fast read, and this is the one that
 * survives without them. A decision outranks the deck's position, since for
 * one render a story can be both.
 */
export function stateLabel(state: RowState): string {
  if (state.decision) return decisionLabel(state.decision);
  return state.onDeck ? "On deck" : "Not seen";
}

/**
 * The thumbnail, at whichever widths this story actually has.
 *
 * `srcset` is only written when both exist, because a single-candidate srcset
 * tells the browser nothing it does not already have from `src`. The 500px
 * thumbnail leads: a row is small, and 327 stories from before phase 1 have
 * nothing else.
 */
function thumbMarkup(story: Story): string {
  const small = safeUrl(story.thumbnailUrl);
  const wide = safeUrl(story.imageUrl);
  const src = small ?? wide;
  if (!src) return "";

  const srcset =
    small && wide
      ? ` srcset="${escapeHtml(`${small} 500w, ${wide} 1000w`)}"`
      : "";
  const sizes = srcset ? ` sizes="120px"` : "";

  return (
    `<img class="row-thumb" src="${escapeHtml(src)}"${srcset}${sizes} ` +
    `alt="${escapeHtml(story.imageAlt ?? "")}" loading="lazy" decoding="async" />`
  );
}

function factsMarkup(story: Story, now: Date): string {
  // The pillar as well as the section: the list has the room, and the pillar
  // is what the filter chips above are keyed on.
  const place = [story.pillar, story.section].filter(Boolean).join(" · ");
  const parts = factParts(story, place || null, now);

  if (story.byline) {
    const label = needsByLabel(story.byline) ? "By " : "";
    parts.push(
      `<span class="quiet">${escapeHtml(label)}${escapeHtml(story.byline)}</span>`
    );
  }

  return parts.join("");
}

/** The two decision buttons, in both of the states each one has. */
export type ActionSlot = "save" | "skip";

export interface ButtonFace {
  act: "save" | "skip" | "clear";
  label: string;
  aria: (slug: string) => string;
  tint: string;
}

/**
 * What each button says in each state, in one place.
 *
 * The list repaints these in place rather than redrawing a row - a reader
 * sitting on the button they just pressed has to keep their place - so the
 * markup here and the repaint there must agree about all four faces. Reading
 * them from one table is what makes that true by construction, and it is the
 * label, the action and the accessible name that have to move together: a
 * button reading "Remove" while its `aria-label` still says "Save to my desk"
 * is worse than either alone.
 */
export const BUTTON_FACES: Record<
  ActionSlot,
  Record<"on" | "off", ButtonFace>
> = {
  save: {
    off: {
      act: "save",
      label: "Save",
      aria: (slug) => `Save ${slug} to my desk`,
      tint: "mini-save",
    },
    on: {
      act: "clear",
      label: "Remove",
      aria: (slug) => `Remove ${slug} from my desk`,
      tint: "",
    },
  },
  skip: {
    off: {
      act: "skip",
      label: "Skip",
      aria: (slug) => `Skip ${slug}`,
      tint: "mini-skip",
    },
    on: {
      act: "clear",
      label: "Un-skip",
      aria: (slug) => `Un-skip ${slug}`,
      tint: "",
    },
  },
};

/**
 * The classes a decision button wears. Exported alongside the table so the
 * list's repaint sets exactly what the markup path sets - the "on" faces carry
 * no tint, and joining an empty one blindly leaves a double space in the DOM.
 */
export function faceClass(face: ButtonFace): string {
  return ["mini", face.tint, "m"].filter(Boolean).join(" ");
}

function decisionButton(
  slot: ActionSlot,
  active: boolean,
  slug: string
): string {
  const face = BUTTON_FACES[slot][active ? "on" : "off"];

  return (
    `<button class="${faceClass(face)}" type="button" data-slot="${slot}" ` +
    `data-act="${face.act}" aria-label="${face.aria(slug)}">${face.label}</button>`
  );
}

/**
 * The three controls.
 *
 * Save becomes Remove and Skip becomes Un-skip once a decision has been made,
 * so the button always says what pressing it will do rather than what state
 * the row is in. `data-act` is what the list's one delegated click handler
 * reads; the story id lives on the row itself.
 */
function actionsMarkup(story: Story, state: RowState): string {
  const slug = escapeHtml(storySlug(story.section, story.id));

  const save = decisionButton("save", state.decision === "saved", slug);
  const skip = decisionButton("skip", state.decision === "skipped", slug);

  const read = guardianLink(
    story.url,
    "mini m",
    "Read",
    `${slug} at the Guardian`
  );

  return `<div class="row-acts">${save}${skip}${read}</div>`;
}

export function renderRow(
  story: Story,
  state: RowState,
  now: Date = new Date()
): string {
  const summary = story.summary
    ? `<p class="row-t">${escapeHtml(story.summary)}</p>`
    : "";

  return (
    `<article class="row" data-story-id="${Number(story.id)}"` +
    `${state.decision ? ` data-state="${state.decision}"` : ""}>` +
    `<div class="row-meta m">` +
    `<span class="quiet">${escapeHtml(storySlug(story.section, story.id))}</span>` +
    `<span class="row-state">${stateLabel(state)}</span>` +
    `</div>` +
    thumbMarkup(story) +
    `<div class="row-body">` +
    `<h3 class="row-h">${escapeHtml(story.title)}</h3>` +
    summary +
    `<p class="row-foot m">${factsMarkup(story, now)}</p>` +
    `</div>` +
    actionsMarkup(story, state) +
    `</article>`
  );
}
