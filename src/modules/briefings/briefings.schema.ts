import { z } from "zod";

/**
 * Upper bound on an id.
 *
 * Both `briefings.id` and `briefing_items.id` are Postgres `integer`, so anything past this is out of range for the column and comes back as SQLSTATE 22003
 *  - a 500 from a value anyone can type into the URL bar.
 * The same trap the wire's `page` and the desk's `storyId` already close.
 */
export const MAX_ID = 2_147_483_647;

/**
 * Upper bound on `page`, for the same reason the wire has one:
 * a large enough value pushes the computed OFFSET into scientific notation, which Postgres rejects as a bigint.
 */
export const MAX_BRIEFINGS_PAGE = 10_000;

export const BRIEFINGS_PAGE_SIZE = 20;

/**
 * How many stories one briefing holds.
 *
 * GET /briefings/:slug returns every story body in the briefing, so something has to bound it
 *  - the same hazard the desk's window closes one table along.
 * A briefing is a selection somebody wrote a note on each of; fifty is far past any real one and still a response that fits comfortably.
 */
export const MAX_BRIEFING_ITEMS = 50;

/**
 * The two statuses, written once and the type derived from them.
 *
 * Same shape as DECISIONS in the desk and TONE_PRECEDENCE in the wire client, and for the same reason:
 * a hand-written union beside a separate array can fall out of step with the compiler saying nothing.
 * The unavoidable pair that remains
 *  - this and the briefing_status enum in db/schema.sql
 *  - is held together by tests/schema-drift.test.ts.
 */
export const BRIEFING_STATUSES = ["draft", "published"] as const;

export type BriefingStatus = (typeof BRIEFING_STATUSES)[number];

const briefingStatusSchema = z.enum(BRIEFING_STATUSES);

/**
 * Optional prose that can also be cleared.
 *
 * Empty and absent are different requests - absent means "leave it alone", empty means "remove what is there" - so the empty string is kept distinct here and folded to NULL by the service rather than rejected.
 */
function optionalProse(max: number) {
  return z.string().trim().max(max).nullable().optional();
}

export const TITLE_MIN = 3;
export const TITLE_MAX = 200;
export const INTRO_MAX = 1000;
export const NOTE_MAX = 500;

const titleSchema = z.string().trim().min(TITLE_MIN).max(TITLE_MAX);

/**
 * A new briefing is always a draft.
 *
 * `status` is deliberately not accepted here:
 * publishing requires at least one story and a briefing has none at the moment it is created, so a `status` a caller could set would only ever be refused.
 * Publishing happens through the PATCH below, once there is something to publish.
 */
export const createBriefingSchema = z.object({
  title: titleSchema,
  intro: optionalProse(INTRO_MAX),
});

/**
 * `published_at` is absent on purpose, as is `author_id`.
 *
 * Both are the server's to decide
 *  - the first because a curator could otherwise backdate a briefing to the top of the public listing, the second because ownership comes from the verified token and never from a body.
 * Unknown keys are dropped by Zod's default object parsing, so sending either is ignored rather than honoured.
 */
export const updateBriefingSchema = z
  .object({
    title: titleSchema.optional(),
    intro: optionalProse(INTRO_MAX),
    status: briefingStatusSchema.optional(),
  })
  // An empty patch is a mistake rather than a no-op, and answering 400 says so instead of reporting a successful update that changed nothing.
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Give at least one of title, intro or status",
  });

export const addItemSchema = z.object({
  storyId: z.number().int().min(1).max(MAX_ID),
  note: optionalProse(NOTE_MAX),
});

/**
 * Only the note is patchable. Position is not a field a caller sets - see the reorder schema below.
 *
 * `note` is required here while it is optional everywhere else, and the difference matters.
 * This is the one field the request can change, so an absent one has two readings
 *  - "clear it" and "leave it alone" - that the server cannot tell apart, and picking either silently would eventually erase somebody's writing.
 * Requiring the key makes clearing explicit: send null or an empty string.
 * An empty body is a 400.
 */
export const updateItemSchema = z.object({
  note: z.string().trim().max(NOTE_MAX).nullable(),
});

/**
 * Reordering states the whole ordering rather than one item's new position.
 *
 * A briefing's order has no valid intermediate state: "item 4 is now first" leaves every other position ambiguous until the client says what happened to them.
 * Sending the full list makes the request idempotent, lets the server assign contiguous positions itself, and gives it something to check
 *  - the service refuses an ordering that is not exactly the briefing's current items.
 */
export const reorderItemsSchema = z.object({
  itemIds: z
    .array(z.number().int().min(1).max(MAX_ID))
    .min(1)
    .max(MAX_BRIEFING_ITEMS),
});

/**
 * Path parameters arrive as strings, so the shape is checked before the value.
 * A regex rather than coercion keeps "1.5" and "nonsense" out instead of silently rounding them, matching the wire and the desk.
 */
const idParam = z
  .string()
  .regex(/^\d+$/, "must be a positive integer")
  .transform(Number)
  .refine(
    (value) => value >= 1 && value <= MAX_ID,
    `must be between 1 and ${MAX_ID}`
  );

export const briefingIdParamSchema = z.object({ id: idParam });

export const itemParamSchema = z.object({ id: idParam, itemId: idParam });

/**
 * Slugs are generated by this server and always match this shape, so anything else is a lookup that could not succeed.
 * Bounded because it reaches a TEXT column: the length limit lives in the generator, not in the database.
 */
export const slugParamSchema = z.object({
  slug: z
    .string()
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "not a briefing address"),
});

/**
 * Usernames are compared case-insensitively everywhere else in this codebase, and the length matches the column.
 */
export const curatorParamSchema = z.object({
  username: z.string().min(1).max(50),
});

export const pageQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, "page must be a positive integer")
    .transform(Number)
    .refine(
      (value) => value >= 1 && value <= MAX_BRIEFINGS_PAGE,
      `page must be between 1 and ${MAX_BRIEFINGS_PAGE}`
    )
    .optional(),
});
