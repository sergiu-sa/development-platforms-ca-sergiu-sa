/**
 * The stories columns the wire depends on.
 *
 * The probe that asks a database whether it actually has them lives in
 * src/db/schema-probe.ts; this file supplies the list and the caller puts the
 * two together. Deliberately free of runtime imports, so a command-line script
 * pointed at a different database can read it without dragging in the pool
 * that src/db/connection.ts builds the moment it loads.
 */

import type { TableProbe } from "../../db/schema-probe.js";

/**
 * Every column the wire query selects, as an array so it can be compared
 * against a real database's column list. The SQL fragment below is derived
 * from it rather than written out again.
 */
export const STORY_COLUMNS = [
  "id",
  "title",
  "summary",
  "standfirst",
  "byline",
  "url",
  "section",
  "pillar",
  "tone",
  "word_count",
  "star_rating",
  "thumbnail_url",
  "image_url",
  "image_alt",
  "image_credit",
  "published_at",
] as const;

/**
 * Columns storeStories writes but the wire never selects.
 *
 * They belong in the probe even though no response carries them. A database
 * missing one accepts every read and fails every refresh, and refreshIfNeeded
 * swallows refresh failures by design - so the symptom would be a wire that
 * quietly stops updating, with nothing in the logs and a health check saying
 * everything is fine. That is the phase 1 failure wearing a different hat.
 */
const WRITE_ONLY_COLUMNS = ["external_id", "fetched_at"] as const;

/**
 * The columns as a SELECT list.
 *
 * This gets interpolated into SQL, which is forbidden everywhere else in this
 * codebase. It is safe here and only here because it is a fixed list defined
 * in this file with no input of any kind reaching it. The rule it appears to
 * break is about *values*, and values still travel as $1 placeholders.
 */
export const WIRE_STORY_COLUMNS = STORY_COLUMNS.join(", ");

/**
 * The same columns qualified with a table alias.
 *
 * A query that joins stories to anything else carrying an `id` - saved_stories
 * does - cannot use the unqualified list: Postgres rejects the ambiguous
 * reference rather than guessing. The alias is a literal written here, exactly
 * like the column names themselves, so this stays as safe to interpolate as
 * the list above and for the same reason.
 */
export const ALIASED_STORY_COLUMNS = STORY_COLUMNS.map(
  (column) => `story.${column}`
).join(", ");

/**
 * Everything the wire needs stories to have: the columns it reads, plus the
 * two it writes but never shows.
 */
export const WIRE_PROBE: TableProbe = {
  table: "stories",
  columns: [...STORY_COLUMNS, ...WRITE_ONLY_COLUMNS],
};
