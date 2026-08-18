/**
 * The briefing being written, and the four things that can change about it.
 *
 * Pure and DOM-free, like `briefing/state.ts` one module along: the page owns the fetches and the markup, and everything decidable about an ordering lives here where a test can reach it without a browser.
 *
 * **Order is the state; position is a label.** Position 1 is the lede because it is first in this array, and moving a story *is* promoting it.
 * Nothing here sets a lead, because there is nothing to set - the server assigns contiguous positions from the order it is handed, and there is no `is_lead` column for a bug to disagree with.
 */

import type { Story } from "../wire/types";

/** One story in the briefing, with whatever the curator has typed about it so far. */
export interface BuilderItem {
  /** `briefing_items.id`, which is what every item write names. */
  id: number;
  storyId: number;
  /**
   * The empty string rather than null while it is being edited.
   * A textarea has no concept of null, and the server folds an empty string to NULL on arrival, so carrying both here would be a distinction with nothing on either side of it.
   */
  note: string;
  story: Story;
}

export interface BuilderState {
  id: number;
  slug: string;
  title: string;
  intro: string;
  status: "draft" | "published";
  items: BuilderItem[];
}

/**
 * The server's limits, restated.
 *
 * They are declared in `src/modules/briefings/briefings.schema.ts` and cannot be imported: `web/` and `src/` are separate builds and nothing crosses between them, so a client that imported the server's schema would pull server code into the bundle.
 *
 * The server stays the authority - every one of these is enforced there and a refusal is shown as it comes back.
 * These exist so a curator is told before they spend a request, not instead of being told.
 */
export const TITLE_MIN = 3;
export const TITLE_MAX = 200;
export const INTRO_MAX = 1000;
export const NOTE_MAX = 500;
export const MAX_ITEMS = 50;

export type MoveDirection = "up" | "down";

/**
 * The items with one story moved a place.
 *
 * Returns the **same array** when the move cannot happen - the story is not here, or it is already at the end it is being moved towards.
 * The caller uses that identity to decide whether anything needs saving, so a no-op must not produce a new array or every press of a disabled control would queue a write.
 */
export function moveItem(
  items: readonly BuilderItem[],
  itemId: number,
  direction: MoveDirection
): readonly BuilderItem[] {
  const from = items.findIndex((item) => item.id === itemId);
  const to = direction === "up" ? from - 1 : from + 1;

  if (from === -1 || to < 0 || to >= items.length) {
    return items;
  }

  const moved = [...items];
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);

  return moved;
}

/** The items without one story. The same array when it was not there to begin with. */
export function removeItem(
  items: readonly BuilderItem[],
  itemId: number
): readonly BuilderItem[] {
  const without = items.filter((item) => item.id !== itemId);

  return without.length === items.length ? items : without;
}

/** The ordering, as the reorder endpoint wants it: every item id, in order, once. */
export function itemIds(items: readonly BuilderItem[]): number[] {
  return items.map((item) => item.id);
}

/**
 * Why this briefing cannot be filed yet, or null when it can.
 *
 * A sentence rather than a disabled button.
 * A control that is simply greyed out makes the reader guess which of two rules they have broken, and WCAG exempts a disabled control from contrast, so the explanation would be the dimmest thing on the bar.
 *
 * Kept to a short phrase deliberately: it sits in a fixed-height bar, and the rule there is that labels shorten rather than wrap.
 * The first draft of this read "Needs a title and at least one story before you can file it" and took three lines at 1440.
 */
export function fileRefusal(state: BuilderState): string | null {
  const needs: string[] = [];

  if (state.title.trim().length < TITLE_MIN) {
    needs.push("a title");
  }

  if (state.items.length === 0) {
    needs.push("one story");
  }

  return needs.length === 0 ? null : `Needs ${needs.join(" and ")}`;
}

/** How many stories can still be added. Zero once the briefing is full. */
export function roomLeft(state: BuilderState): number {
  return Math.max(0, MAX_ITEMS - state.items.length);
}

/** Stories in the briefing that nobody has written about yet. */
export function unwrittenCount(state: BuilderState): number {
  return state.items.filter((item) => item.note.trim() === "").length;
}
