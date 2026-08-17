/**
 * Everything the builder says, in one place.
 *
 * Here rather than inline for the reason `briefing/copy.ts` exists: a sentence written twice is a sentence that gets edited once.
 *
 * Two house rules are doing work in these strings. Controls say exactly what happens, so the buttons are Move up, Remove and File rather than anything cleverer.
 * And an empty state is an invitation rather than a shrug - the one below tells a curator where the stories come from, because at that moment they have a briefing and no idea what to put in it.
 */

export const BUILDER_COPY = {
  kicker: "Building a briefing",

  titlePlaceholder: "Give it a title",
  introPlaceholder: "Set it up in a sentence or two. Optional.",
  notePlaceholder: "Why this one, in your words.",

  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",

  lede: "the lede",

  addStories: "Add stories from your desk",
  full: "This briefing is full",

  emptyHeading: "Nothing in it yet",
  emptyBody:
    "Everything you have saved to your desk can go in this briefing, in whatever order you want it read.",

  file: "File this briefing",
  withdraw: "Move back to a draft",
  /** The same control at 390, where the full phrase wraps the fixed bar. */
  withdrawShort: "To a draft",
  view: "Read it",
  delete: "Delete this briefing",

  /** Shown while a delete is one press from happening. Never a browser dialog: those block the page and cannot be styled or read properly. */
  deleteConfirm: "Delete it for good",
  deleteCancel: "Keep it",

  saved: "Saved",
  saving: "Saving",
  unsaved: "Not saved",

  /**
   * What a curator is told when the page cannot be loaded, and it is deliberately not "something went wrong".
   * An error states what happened and what to do.
   */
  loadFailed:
    "Could not load your briefings. Check your connection and reload.",
  notYours: "That briefing does not exist",
  /** The one rule that applies before a briefing exists at all. */
  titleTooShort: (min: number) => `A title needs at least ${min} characters`,
} as const;

/** "1 story" against "6 stories", which is printed on three surfaces here. */
export function storyCount(count: number): string {
  return `${count} ${count === 1 ? "story" : "stories"}`;
}
