/**
 * A short label for a story - "SPORT-1053" - threaded onto the deck's rails,
 * printed on the card and repeated in the toast.
 *
 * Derived from the story's id, never from its position in a list. A
 * position-derived slug changes when the wire refreshes or a filter narrows
 * the view, so the same story would carry one label on the rail and a
 * different one in the list directly below it.
 *
 * Sections with no letters at all, and stories with no section, fall back to
 * WIRE rather than producing a bare hyphen.
 */
export function storySlug(
  section: string | null | undefined,
  id: number
): string {
  const word = (section ?? "").toUpperCase().match(/[A-Z]+/)?.[0] ?? "WIRE";
  return `${word.slice(0, 8)}-${id}`;
}
