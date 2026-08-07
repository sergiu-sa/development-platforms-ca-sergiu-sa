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

/**
 * One end of a window, as an instant Postgres will actually accept.
 *
 * `z.string().datetime()` is looser than `timestamptz` in two ways, and both produce a 500 from a value anyone can type into the URL bar:
 * Postgres has no year zero (SQLSTATE 22008) and rejects UTC offsets past ±15:59 (22009), while Zod's regex allows `0000` and any four digits of offset.
 * `Date.parse` accepts all of them too, so a comparison of the two bounds does not catch it either.
 *
 * Normalising to UTC removes the offset case, and flooring at the epoch removes the year case;
 * nothing on a news desk was decided before 1970.
 * The server then only ever hands Postgres a `Z` instant.
 */
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) >= 0, "must be a usable instant")
  .transform((value) => new Date(value).toISOString());

/** The widest window the full read will serve. */
export const MAX_WINDOW_DAYS = 31;

/**
 * One edition's window, as two absolute instants.
 *
 * The browser works out when its own midnight was and sends the result, so Postgres compares timestamps and never has to know what timezone the reader is in - no `AT TIME ZONE`, no calendar arithmetic in SQL, and no untrusted timezone name to validate.
 * `from` is inclusive and `to` exclusive, so two consecutive days cannot both claim the same story.
 *
 * Required together for the full form, and capped in span, which is what makes the full read bounded: asking for every story body a reader has ever saved stops being expressible.
 * `compact` stays unranged because it is a few dozen bytes per decision and the archive strip needs all of them.
 */
export const deskQuerySchema = z
  .object({
    state: decisionSchema.optional(),
    from: instant.optional(),
    to: instant.optional(),
    /**
     * `compact` drops the story body and returns the decision alone.
     *
     * The homepage needs a storyId-to-state map and nothing else, but a desk entry carries a whole story row - roughly a kilobyte of JSON.
     * Skips are stored as well as saves, so the table grows with every card triaged rather than every card kept:
     * a reader triaging fifty stories a day would cross Vercel's 4.5 MB response cap inside a few months, at which point the homepage stops loading their desk at all.
     *
     * A flag rather than a second endpoint, and off by default, so `GET /api/desk` still means "the desk" and the caller that needs speed asks for it.
     */
    view: z.enum(["full", "compact"]).optional(),
  })
  // `compact` reads neither bound, so a window sent with it is refused rather than dropped:
  // silently returning the reader's whole history to a caller that asked for one day is the kind of over-read nobody notices until the response stops fitting.
  .refine((query) => query.view !== "compact" || query.from === undefined, {
    message: "view=compact does not take a window",
    path: ["from"],
  })
  .refine(
    (query) =>
      query.view === "compact" ||
      (query.from === undefined) === (query.to === undefined),
    { message: "from and to must be given together", path: ["from"] }
  )
  // Compared as instants, not as strings. `datetime({ offset: true })` admits "…+02:00" as well as "…Z", and lexicographic order is only chronological while every value happens to share one offset.
  .refine(
    (query) =>
      !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to),
    { message: "from must be before to", path: ["from"] }
  )
  // The whole point of the window: without it the full form would still be able to ask for every story body on the desk at once, which is the unbounded read this parameter exists to close.
  .refine((query) => query.view === "compact" || query.from !== undefined, {
    message: "from and to are required unless view=compact",
    path: ["from"],
  })
  // Requiring a window is not the same as bounding one.
  // Without a cap, `from=1970-01-01&to=9999-12-31` is a legal window and the whole desk comes back in one response;
  // which is the read the two rules above are supposed to have closed.
  // A month is far wider than the page asks for (it requests a day) and still small enough to stay well inside Vercel's response cap.
  .refine(
    (query) =>
      query.view === "compact" ||
      !query.from ||
      !query.to ||
      Date.parse(query.to) - Date.parse(query.from) <=
        MAX_WINDOW_DAYS * 86_400_000,
    {
      message: `from and to must be at most ${MAX_WINDOW_DAYS} days apart`,
      path: ["to"],
    }
  );

/**
 * Path parameters arrive as strings, so the shape is checked before the value is.
 * A regex rather than coercion keeps "1.5" and "nonsense" out instead of silently rounding them, matching how the wire validates its page number.
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
