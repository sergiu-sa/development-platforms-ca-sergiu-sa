/**
 * The desk: what a reader has done with each story.
 *
 * Every function here takes `userId` as its first argument and puts it in the WHERE clause.
 * That is the whole security model, and it is deliberately not expressible any other way;
 * there is no query in this file that can reach a row without naming whose row it is.
 * The route layer takes that id from the verified JWT and nowhere else.
 */

import { pool } from "../../db/connection.js";
import { ALIASED_STORY_COLUMNS } from "../wire/wire.columns.js";
import { toWireStory } from "../wire/wire.service.js";
import type { StoryColumnsRow, WireStoryRow } from "../wire/wire.service.js";
import type { Decision } from "./desk.schema.js";

export type { Decision };

/**
 * A decision on its own, which is what the writes return.
 *
 * They deliberately do not carry the story:
 * the only caller is a client that just decided a story it is already holding, so sending it back would be paying for a join to return something the requester supplied.
 */
export interface DeskDecision {
  storyId: number;
  state: Decision;
  decidedAt: string;
}

/** A decision plus the story it is about, which is what the read returns. */
export interface DeskEntry extends DeskDecision {
  story: WireStoryRow;
}

interface DeskEntryRow extends StoryColumnsRow {
  state: Decision;
  decided_at: Date;
}

interface DeskDecisionRow {
  story_id: number;
  state: Decision;
  decided_at: Date;
}

function toDecision(row: DeskDecisionRow): DeskDecision {
  return {
    storyId: row.story_id,
    state: row.state,
    decidedAt: row.decided_at.toISOString(),
  };
}

/** The window one edition covers: local midnight to local midnight. */
export interface DeskWindow {
  /** Inclusive. */
  from: string;
  /** Exclusive, so consecutive days cannot both claim the same story. */
  to: string;
}

/**
 * One edition: the decisions a reader made inside a window, newest first, each with the story it is about.
 *
 * The window is a required argument, not an optional one the schema happens to always supply.
 * That is what keeps the response bounded:
 * a day's saves rather than every story body the reader has ever kept;
 * and having it in the signature means the bound is enforced by the compiler rather than by a refinement plus a comment explaining what it implies.
 * The bounds arrive as absolute instants computed in the browser, so this comparison needs no timezone of its own.
 *
 * Skipped stories are included unless filtered out, though nothing asks for them here today:
 * the homepage needs skips but reads them through `listDeskCompact`, and the desk sends `state=saved`.
 * The filter stays because it is the same one every other read in this file takes.
 */
export async function listDesk(
  userId: number,
  window: DeskWindow,
  state?: Decision
): Promise<DeskEntry[]> {
  const { rows } = await pool.query<DeskEntryRow>(
    `SELECT ${ALIASED_STORY_COLUMNS}, desk.state, desk.decided_at
       FROM saved_stories desk
       JOIN stories story ON story.id = desk.story_id
      WHERE desk.user_id = $1
        AND ($2::story_decision IS NULL OR desk.state = $2)
        AND desk.decided_at >= $3
        AND desk.decided_at < $4
      ORDER BY desk.decided_at DESC, desk.story_id DESC`,
    [userId, state ?? null, window.from, window.to]
  );

  return rows.map((row) => ({
    storyId: row.id,
    state: row.state,
    decidedAt: row.decided_at.toISOString(),
    story: toWireStory(row),
  }));
}

/**
 * The same decisions without the stories.
 *
 * No join and no story columns, so the response stays a few dozen bytes per decision however long the reader has been using the site.
 * The homepage asks for this: it builds a storyId-to-state map and throws every story body away, and it is the one caller that runs on every page load.
 */
export async function listDeskCompact(
  userId: number,
  state?: Decision
): Promise<DeskDecision[]> {
  const { rows } = await pool.query<DeskDecisionRow>(
    `SELECT story_id, state, decided_at
       FROM saved_stories
      WHERE user_id = $1
        AND ($2::story_decision IS NULL OR state = $2)
      ORDER BY decided_at DESC, story_id DESC`,
    [userId, state ?? null]
  );

  return rows.map(toDecision);
}

/**
 * Records one decision, replacing whatever was there before.
 *
 * Null means the story is not in the cache, which the route reports as a 404.
 * That case is decided by the JOIN rather than by catching a foreign key violation:
 * a stale client holding an id we have since dropped is ordinary traffic, not an error condition, and reading it off an exception would mean a SQLSTATE from any other cause could be mistaken for it.
 */
export async function setDecision(
  userId: number,
  storyId: number,
  state: Decision
): Promise<DeskDecision | null> {
  const { rows } = await pool.query<DeskDecisionRow>(
    `INSERT INTO saved_stories (user_id, story_id, state)
     SELECT $1, story.id, $3::story_decision
       FROM stories story
      WHERE story.id = $2
     ON CONFLICT (user_id, story_id) DO UPDATE
        SET state = EXCLUDED.state,
            decided_at = now()
     RETURNING story_id, state, decided_at`,
    [userId, storyId, state]
  );

  return rows[0] ? toDecision(rows[0]) : null;
}

/**
 * Takes a story back off the desk, undecided.
 *
 * False means there was nothing to remove, which is not an error:
 * a reader pressing undo on a decision that never reached the server is the ordinary way to get here.
 * It is also what stops this leaking: an id belonging to somebody else matches no row of ours and answers exactly the same way as an id nobody has decided.
 */
export async function removeDecision(
  userId: number,
  storyId: number
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM saved_stories WHERE user_id = $1 AND story_id = $2",
    [userId, storyId]
  );

  return rowCount === 1;
}

export interface MergeResult {
  /** Decisions written. */
  merged: number;
  /** Named stories that are no longer in the cache, so could not be written. */
  dropped: number;
}

/**
 * Folds a signed-out session's decisions into an account, in one round trip.
 *
 * The incoming decisions win on conflict.
 * They are the newer intent:
 * the reader made them moments ago in this tab, and anything already on the desk for the same story was decided on some earlier visit.
 *
 * Stories missing from the cache are dropped rather than failing the batch.
 * A session can outlive the wire page it was made against, and losing a whole migration because one story aged out would be the worst possible trade.
 */
export async function mergeDecisions(
  userId: number,
  entries: readonly { storyId: number; state: Decision }[]
): Promise<MergeResult> {
  // Deduplicated before it reaches Postgres, last mention winning.
  // ON CONFLICT DO UPDATE refuses to touch the same row twice in one statement, so a body naming a story twice would otherwise be a 500.
  // The frontend builds this from a Map and cannot produce one, but the endpoint is reachable without it.
  const latest = new Map<number, Decision>();
  for (const entry of entries) latest.set(entry.storyId, entry.state);

  if (latest.size === 0) {
    return { merged: 0, dropped: 0 };
  }

  // Sorted so every merge locks rows in the same order.
  // Two tabs on one account naming the same stories in different orders would otherwise be able to deadlock each other, which Postgres resolves by killing one with 40P01;
  // a 500 for the reader, on the request that carries their whole signed-out session.
  const storyIds = [...latest.keys()].sort((a, b) => a - b);
  const states = storyIds.map((storyId) => latest.get(storyId)!);

  const { rowCount } = await pool.query(
    `INSERT INTO saved_stories (user_id, story_id, state)
     SELECT $1, story.id, incoming.state
       FROM UNNEST($2::int[], $3::story_decision[])
              AS incoming(story_id, state)
       JOIN stories story ON story.id = incoming.story_id
     ON CONFLICT (user_id, story_id) DO UPDATE
        SET state = EXCLUDED.state,
            decided_at = now()`,
    [userId, storyIds, states]
  );

  const merged = rowCount ?? 0;

  return { merged, dropped: latest.size - merged };
}
