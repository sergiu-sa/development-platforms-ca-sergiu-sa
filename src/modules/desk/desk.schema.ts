import { z } from "zod";

/**
 * Upper bound on a story id.
 *
 * story_id is a Postgres `integer`, so anything past this is out of range for
 * the column and comes back as SQLSTATE 22003 - a 500 from a value anyone can
 * type into the URL bar. The same trap as the unbounded `page` on the wire,
 * one table along.
 */
export const MAX_STORY_ID = 2_147_483_647;

/**
 * Cap on one migration.
 *
 * A signed-out session cannot legitimately hold more decisions than the wire
 * holds stories, so this is far above any real body while keeping a
 * hand-written one from turning into an unbounded array of parameters.
 */
export const MAX_MERGE_ENTRIES = 500;

/**
 * The two states, written once.
 *
 * The type is derived from the array rather than declared beside it, which is
 * the same shape as TONE_PRECEDENCE in the wire client and for the same
 * reason: a hand-written union and a separate array can fall out of step with
 * the compiler saying nothing. That leaves one unavoidable pair - this and the
 * story_decision enum in db/schema.sql - and tests/schema-drift.test.ts is
 * what holds those two together.
 */
export const DECISIONS = ["saved", "skipped"] as const;

export type Decision = (typeof DECISIONS)[number];

export const decisionSchema = z.enum(DECISIONS);

export const deskQuerySchema = z.object({
  state: decisionSchema.optional(),
  /**
   * `compact` drops the story body and returns the decision alone.
   *
   * The homepage needs a storyId-to-state map and nothing else, but a desk
   * entry carries a whole story row - roughly a kilobyte of JSON. Skips are
   * stored as well as saves, so the table grows with every card triaged rather
   * than every card kept, and the full response is unbounded: a reader
   * triaging fifty stories a day crosses Vercel's 4.5 MB response cap inside a
   * few months, at which point the homepage stops loading their desk at all.
   *
   * A flag rather than a second endpoint, and off by default, so `GET
   * /api/desk` still means "the desk" and the caller that needs speed asks for
   * it. The full form stays for /desk in phase 7, where the story bodies are
   * the point.
   */
  view: z.enum(["full", "compact"]).optional(),
});

/**
 * Path parameters arrive as strings, so the shape is checked before the value
 * is. A regex rather than coercion keeps "1.5" and "nonsense" out instead of
 * silently rounding them, matching how the wire validates its page number.
 */
export const storyIdParamSchema = z.object({
  storyId: z
    .string()
    .regex(/^\d+$/, "storyId must be a positive integer")
    .transform(Number)
    .refine(
      (value) => value >= 1 && value <= MAX_STORY_ID,
      `storyId must be between 1 and ${MAX_STORY_ID}`
    ),
});

export const decisionBodySchema = z.object({
  state: decisionSchema,
});

export const mergeBodySchema = z.object({
  entries: z
    .array(
      z.object({
        storyId: z.number().int().min(1).max(MAX_STORY_ID),
        state: decisionSchema,
      })
    )
    .max(MAX_MERGE_ENTRIES),
});
