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

/**
 * An id-to-slug lookup for a wire that does not change.
 *
 * Both the browse list and the deck's rails need a slug when all they have is
 * an id, and each had grown its own map - the rails rebuilding theirs twice on
 * every decision. Built once at mount and read from thereafter.
 *
 * Takes the shape it uses rather than `Story`, because `lib/` is the bottom of
 * the dependency order and must not import from `wire/`.
 */
export function slugIndex(
  stories: readonly { id: number; section: string | null }[]
): Map<number, string> {
  return new Map(
    stories.map((story) => [story.id, storySlug(story.section, story.id)])
  );
}
