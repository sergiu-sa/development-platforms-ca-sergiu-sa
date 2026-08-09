/**
 * Briefings: what a curator filed, and the stories they filed in it.
 *
 * Two rules hold this file together, and both are structural rather than conventional.
 *
 * **Ownership is a lock, not a check.
 * ** Every write that reads before it writes goes through `lockOwnBriefing`, which selects the briefing by id *and* author_id `FOR UPDATE`.
 * The lock serialises the two requests; reading the item count in a **separate statement afterwards** is what makes the number they decide on fresh.
 * Both halves are needed, and the second half is easy to lose - see `countItems`, which records the measurement.
 *
 * `deleteBriefing` is the one write that does not take it, because it reads nothing first: ownership sits in its WHERE clause instead.
 * That is the rule underneath both - **no query in this file can reach a briefing without naming whose it is**
 *  - and the lock is how the rule is kept when a write has to look before it leaps.
 *
 * **Draft visibility is a WHERE clause, not a branch.
 * ** The public read carries `(status = 'published' OR author_id = $2)` with `$2` null for an anonymous caller. `author_id = NULL` is never true in SQL, so a stranger seeing a draft is not something a later refactor can acidentally allow.
 */

import { pool, withTransaction } from "../../db/connection.js";
import type pg from "pg";
import { ALIASED_STORY_COLUMNS } from "../wire/wire.columns.js";
import { toWireStory } from "../wire/wire.service.js";
import type { StoryColumnsRow, WireStoryRow } from "../wire/wire.service.js";
import { briefingSlug, randomSuffix } from "./briefings.slug.js";
import {
  BRIEFINGS_PAGE_SIZE,
  MAX_BRIEFING_ITEMS,
  type BriefingStatus,
} from "./briefings.schema.js";

export type { BriefingStatus };

/** A briefing without its stories, which is what a listing returns. */
export interface BriefingSummary {
  id: number;
  slug: string;
  title: string;
  intro: string | null;
  status: BriefingStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Only ever the public display name.
   * An email here would publish the whole userbase to anonymous visitors, which is the oldest standing rule in this
   * codebase.
   */
  author: { username: string };
  itemCount: number;
}

/** One story in a briefing, with the curator's note on it. */
export interface BriefingItem {
  id: number;
  storyId: number;
  note: string | null;
  /** 1 is the lede. Derived from order, never from a flag. */
  position: number;
  story: WireStoryRow;
}

/** A briefing and everything in it, which is what the reading view needs. */
export interface Briefing extends BriefingSummary {
  items: BriefingItem[];
}

/**
 * A decision alone, which is what the item writes return.
 *
 * No story, for the reason the desk's writes carry none:
 * the only caller is a client that just named a story it is already holding, so joining to send it back is paying for something the requester supplied.
 */
export interface BriefingItemRef {
  id: number;
  storyId: number;
  note: string | null;
  position: number;
}

/**
 * Why a write could not happen.
 *
 * A discriminated reason rather than a thrown error, so the route layer owns every status code and message in one readable place and the service stays free of HTTP.
 */
export type BriefingRefusal =
  /** No such briefing, or it is not yours. The two are answered identically. */
  | "not-found"
  /** The named story is not in the wire cache. */
  | "story-not-on-wire"
  /** It is already in this briefing; the unique constraint says so. */
  | "story-already-in-briefing"
  /** A briefing needs a story before it can be published. */
  | "needs-a-story"
  /** Taking the last story out of a published briefing would empty it. */
  | "published-needs-a-story"
  /** The briefing is at MAX_BRIEFING_ITEMS. */
  | "briefing-is-full"
  /** A reorder that is not exactly this briefing's items, each once. */
  | "ordering-must-match";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: BriefingRefusal };

/**
 * The refusal branch never mentions T, so this deliberately is not generic
 *  -a type argument here would make all thirteen call sites restate the enclosing function's return type for nothing.
 */
function refuse(reason: BriefingRefusal): {
  ok: false;
  reason: BriefingRefusal;
} {
  return { ok: false, reason };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

interface BriefingRow {
  id: number;
  slug: string;
  title: string;
  intro: string | null;
  status: BriefingStatus;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  username: string;
  item_count: number;
}

interface ItemRow extends StoryColumnsRow {
  item_id: number;
  note: string | null;
  position: number;
}

interface ItemRefRow {
  id: number;
  story_id: number;
  note: string | null;
  position: number;
}

function toSummary(row: BriefingRow): BriefingSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    intro: row.intro,
    status: row.status,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    author: { username: row.username },
    itemCount: row.item_count,
  };
}

function toItemRef(row: ItemRefRow): BriefingItemRef {
  return {
    id: row.id,
    storyId: row.story_id,
    note: row.note,
    position: row.position,
  };
}

/**
 * The briefing columns every read returns, with the author's public name and a count of what is in it.
 * Written once because four queries select it.
 */
export const BRIEFING_FIELDS = `briefing.id, briefing.slug, briefing.title,
         briefing.intro, briefing.status, briefing.published_at,
         briefing.created_at, briefing.updated_at,
         author.username,
         (SELECT count(*)
            FROM briefing_items item
           WHERE item.briefing_id = briefing.id)::int AS item_count`;

const BRIEFING_SOURCE = `FROM briefings briefing
       JOIN users author ON author.id = briefing.author_id`;

/**
 * What the public may see, written once because two queries ask it - the page and the count behind it.
 * They have to agree or a listing reports a total it cannot show.
 */
const PUBLISHED_FILTER = `briefing.status = 'published'
        AND ($1::int IS NULL OR briefing.author_id = $1)`;

/**
 * Empty prose means "clear this", absent means "leave it alone".
 *
 * The column is nullable and a zero-length string is not a different state from no string, so one of the two has to win before it reaches Postgres or the API grows a distinction it does not mean.
 */
function orNull(value: string | null | undefined): string | null {
  return value || null;
}

/**
 * Creates a draft.
 *
 * The suffix generator is a parameter with a default, the same shape the Guardian client uses for `fetchImpl`:
 * it is the only way to exercise the collision retry below without waiting for a 1-in-65536 event.
 * The retry exists because the random suffix makes a clash unlikely, not impossible, and the alternative
 *  - querying for a free slug first - is a race of its own.
 */
export async function createBriefing(
  userId: number,
  input: { title: string; intro?: string | null },
  makeSuffix: () => string = randomSuffix
): Promise<BriefingSummary> {
  const intro = orNull(input.intro);

  for (let attempt = 0; ; attempt++) {
    try {
      const { rows } = await pool.query<BriefingRow>(
        `WITH created AS (
           INSERT INTO briefings (author_id, title, intro, slug)
           VALUES ($1, $2, $3, $4)
           RETURNING *
         )
         SELECT ${BRIEFING_FIELDS}
           FROM created briefing
           JOIN users author ON author.id = briefing.author_id`,
        [userId, input.title, intro, briefingSlug(input.title, makeSuffix())]
      );

      return toSummary(rows[0]);
    } catch (error) {
      const { code, constraint } = error as {
        code?: string;
        constraint?: string;
      };
      const clashed = code === "23505" && constraint === "briefings_slug_key";

      // Only the slug is retried, and only a few times.
      // Anything else - or a run of bad luck this long - is a real failure and belongs in the log rather than in a loop.
      if (!clashed || attempt >= 4) {
        throw error;
      }
    }
  }
}

/**
 * One briefing by its public address.
 *
 * `viewer` is the signed-in reader's id or null.
 * It appears once, in the WHERE clause, and that single line is the entire draft-privacy rule
 *  a draft belongs to its author and does not exist for anybody else. 404 rather than 403 for a stranger, so a draft's existence is not disclosed by the status code.
 */
export async function getBriefingBySlug(
  slug: string,
  viewer: number | null
): Promise<Briefing | null> {
  const { rows } = await pool.query<BriefingRow>(
    `SELECT ${BRIEFING_FIELDS}
       ${BRIEFING_SOURCE}
      WHERE briefing.slug = $1
        AND (briefing.status = 'published' OR briefing.author_id = $2)`,
    [slug, viewer]
  );

  if (!rows[0]) {
    return null;
  }

  return { ...toSummary(rows[0]), items: await listItems(rows[0].id) };
}

/**
 * The stories in a briefing, in the curator's order.
 *
 * `item.id` is aliased because the join brings `stories.id` along with it and pg returns one object per row - two columns called `id` would silently leave whichever came last, which is the story's.
 */
async function listItems(briefingId: number): Promise<BriefingItem[]> {
  const { rows } = await pool.query<ItemRow>(
    `SELECT item.id AS item_id, item.note, item.position,
            ${ALIASED_STORY_COLUMNS}
       FROM briefing_items item
       JOIN stories story ON story.id = item.story_id
      WHERE item.briefing_id = $1
      ORDER BY item.position, item.id`,
    [briefingId]
  );

  return rows.map((row) => ({
    id: row.item_id,
    storyId: row.id,
    note: row.note,
    position: row.position,
    story: toWireStory(row),
  }));
}

export interface BriefingPage {
  briefings: BriefingSummary[];
  total: number;
}

/**
 * Published briefings, newest first.
 *
 * The ORDER BY matches briefings_public_idx exactly, which is a partial index on the published rows
 *  - so the filter and the sort are the same read.
 * Drafts are absent because the WHERE says `status = 'published'`, which is the listing half of "a draft is invisible to everyone but its author".
 */
export async function listPublished(page: number): Promise<BriefingPage> {
  return listBriefings(page, null);
}

/**
 * One curator's published briefings. Null when there is no such user, so the route can answer 404 rather than an empty profile for a name nobody has.
 */
export async function listByCurator(
  username: string,
  page: number
): Promise<(BriefingPage & { username: string }) | null> {
  // Case-insensitive, matching the LOWER() unique index on the column. A lookup that compared case-sensitively would 404 for a reader who typed a byline the way it is printed.
  const { rows } = await pool.query<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)",
    [username]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    username: rows[0].username,
    ...(await listBriefings(page, rows[0].id)),
  };
}

async function listBriefings(
  page: number,
  authorId: number | null
): Promise<BriefingPage> {
  const offset = (page - 1) * BRIEFINGS_PAGE_SIZE;

  const { rows } = await pool.query<BriefingRow & { total_count: string }>(
    `SELECT ${BRIEFING_FIELDS},
            count(*) OVER () AS total_count
       ${BRIEFING_SOURCE}
      WHERE ${PUBLISHED_FILTER}
      ORDER BY briefing.published_at DESC, briefing.id DESC
      LIMIT $2 OFFSET $3`,
    [authorId, BRIEFINGS_PAGE_SIZE, offset]
  );

  if (rows[0]) {
    return {
      briefings: rows.map(toSummary),
      total: Number(rows[0].total_count),
    };
  }

  // count(*) OVER () rides along with the rows, so an empty page carries no total at all.
  // On page 1 that is not a problem worth a second query
  //  - zero rows on the first page proves the total is zero, and until briefings exist that is every request this endpoint serves.
  // Only a page past the end has to go and ask.
  return {
    briefings: [],
    total: page === 1 ? 0 : await countPublished(authorId),
  };
}

async function countPublished(authorId: number | null): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM briefings briefing
      WHERE ${PUBLISHED_FILTER}`,
    [authorId]
  );

  return Number(rows[0].total);
}

interface LockedBriefing {
  id: number;
  status: BriefingStatus;
  publishedAt: Date | null;
}

/**
 * The one way into a write.
 *
 * Selects the briefing by id **and** author_id, so a briefing belonging to somebody else is indistinguishable from one that does not exist
 *  - the route answers 404 to both, and a caller cannot probe for the existence of another curator's draft.
 *
 * FOR UPDATE holds the row for the rest of the transaction, which is what makes the invariants safe rather than merely checked: publishing reads the item count and then writes, and removing an item reads it and then deletes.
 * Without the lock, two requests interleaving between those two steps could leave a published briefing with nothing in it.
 */
async function lockOwnBriefing(
  client: pg.PoolClient,
  userId: number,
  briefingId: number
): Promise<LockedBriefing | null> {
  const { rows } = await client.query<{
    id: number;
    status: BriefingStatus;
    published_at: Date | null;
  }>(
    `SELECT briefing.id, briefing.status, briefing.published_at
       FROM briefings briefing
      WHERE briefing.id = $1 AND briefing.author_id = $2
      FOR UPDATE OF briefing`,
    [briefingId, userId]
  );

  const row = rows[0];

  return row
    ? { id: row.id, status: row.status, publishedAt: row.published_at }
    : null;
}

/**
 * How many stories the briefing holds, read **after** the lock rather than
 * with it.
 *
 * This separation is the whole point, and it is not tidiness. The count used to
 * be a sub-select inside the locking statement, which reads correctly right up
 * until it matters: under READ COMMITTED a statement that blocks on a row lock
 * re-checks the qual against the newest version of *that row*, while everything
 * else it touches stays on the snapshot taken when the statement began. So
 * `status` came back fresh and the count came back stale.
 *
 * Measured, not deduced. Two connections, a published briefing holding two
 * stories: A takes the lock, deletes one, commits; B, blocked on the lock
 * throughout, then reports **two**. Issued as its own statement after the lock
 * it reports one, because in READ COMMITTED each new statement takes a new
 * snapshot.
 *
 * That difference is the difference between the guards below being enforced and
 * merely appearing to be. Two concurrent deletes on a filed briefing holding
 * two stories would both have seen two, both passed, and left it empty.
 */
async function countItems(
  client: pg.PoolClient,
  briefingId: number
): Promise<number> {
  const { rows } = await client.query<{ item_count: number }>(
    "SELECT count(*)::int AS item_count FROM briefing_items WHERE briefing_id = $1",
    [briefingId]
  );

  return rows[0].item_count;
}

/** Every item write touches the briefing, so every one of them dates it. */
async function touch(client: pg.PoolClient, briefingId: number): Promise<void> {
  await client.query("UPDATE briefings SET updated_at = now() WHERE id = $1", [
    briefingId,
  ]);
}

/**
 * Edits a briefing, including publishing and withdrawing it.
 *
 * `published_at` is set the first time status becomes `published` and never rewritten.
 * Withdrawing to draft keeps it, so re-publishing does not jump the briefing back to the top of the public listing and a link that quoted the date does not start disagreeing with the page.
 */
export async function updateBriefing(
  userId: number,
  briefingId: number,
  patch: { title?: string; intro?: string | null; status?: BriefingStatus }
): Promise<Result<BriefingSummary>> {
  return withTransaction(async (client) => {
    const briefing = await lockOwnBriefing(client, userId, briefingId);

    if (!briefing) {
      return refuse("not-found");
    }

    // An empty briefing has nothing to say, so it cannot be published.
    // Checked under the lock taken above, which is what stops the last item being removed between this read and the write below.
    // Counted only when it is about to matter, so a title-only patch does not
    // pay for a question it never asks.
    if (
      patch.status === "published" &&
      (await countItems(client, briefingId)) === 0
    ) {
      return refuse("needs-a-story");
    }

    const { rows } = await client.query<BriefingRow>(
      `WITH updated AS (
         UPDATE briefings
          SET title = COALESCE($3::text, title),
              intro = CASE WHEN $4::boolean THEN $5::text ELSE intro END,
              status = COALESCE($6::briefing_status, status),
              published_at = CASE
                WHEN COALESCE($6::briefing_status, status) = 'published'
                     AND published_at IS NULL
                THEN now()
                ELSE published_at
              END,
              updated_at = now()
        WHERE id = $1 AND author_id = $2
        RETURNING *
       )
       SELECT ${BRIEFING_FIELDS}
         FROM updated briefing
         JOIN users author ON author.id = briefing.author_id`,
      [
        briefingId,
        userId,
        patch.title ?? null,
        // Whether the intro was mentioned at all, kept separate from its value so that clearing it is expressible.
        // COALESCE cannot do this: it reads "clear this" and "leave it alone" as the same null.
        "intro" in patch,
        orNull(patch.intro),
        patch.status ?? null,
      ]
    );

    return ok(toSummary(rows[0]));
  });
}

/** Deletes a briefing. Its items go with it through ON DELETE CASCADE. */
export async function deleteBriefing(
  userId: number,
  briefingId: number
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM briefings WHERE id = $1 AND author_id = $2",
    [briefingId, userId]
  );

  return rowCount === 1;
}

/**
 * Adds a story to the end of a briefing.
 *
 * The story is required to be in the wire cache and nothing more
 *  - not on the author's desk. The foreign key points at `stories`, and requiring a desk row would tie two features together such that adding a story straight off the wire later became a breaking change.
 */
export async function addItem(
  userId: number,
  briefingId: number,
  input: { storyId: number; note?: string | null }
): Promise<Result<BriefingItemRef>> {
  return withTransaction(async (client) => {
    const briefing = await lockOwnBriefing(client, userId, briefingId);

    if (!briefing) {
      return refuse("not-found");
    }

    if ((await countItems(client, briefingId)) >= MAX_BRIEFING_ITEMS) {
      return refuse("briefing-is-full");
    }

    try {
      // Position is the server's to assign, computed under the lock held above, so two tabs adding at once cannot both claim the same one.
      const { rows } = await client.query<ItemRefRow>(
        `INSERT INTO briefing_items (briefing_id, story_id, note, position)
         SELECT $1, story.id, $3,
                COALESCE((SELECT max(position) FROM briefing_items
                           WHERE briefing_id = $1), 0) + 1
           FROM stories story
          WHERE story.id = $2
         RETURNING id, story_id, note, position`,
        [briefingId, input.storyId, orNull(input.note)]
      );

      // No row means the SELECT found no story, so there was nothing to insert.
      // Decided by the join rather than by catching a foreign key violation, the same way the desk decides it:
      // a client holding an id that has since left the cache is ordinary traffic, and reading it off an exception would let an unrelated SQLSTATE be mistaken for it.
      if (!rows[0]) {
        return refuse("story-not-on-wire");
      }

      await touch(client, briefingId);

      return ok(toItemRef(rows[0]));
    } catch (error) {
      const { code, constraint } = error as {
        code?: string;
        constraint?: string;
      };

      // The one case the database is the right place to decide, because it is the only thing that can decide it without a race.
      //
      // Returning rather than rethrowing leaves withTransaction to issue a COMMIT on a transaction Postgres has already marked as aborted, which it answers as a rollback rather than an error
      // - so nothing was written and the lock is released either way.
      // Worth saying out loud, because it reads like a bug and is not one.
      if (code === "23505" && constraint === "briefing_items_unique_story") {
        return refuse("story-already-in-briefing");
      }

      throw error;
    }
  });
}

/** Rewrites one story's note. Position is not editable here; see reorder. */
export async function updateItem(
  userId: number,
  briefingId: number,
  itemId: number,
  patch: { note?: string | null }
): Promise<Result<BriefingItemRef>> {
  return withTransaction(async (client) => {
    const briefing = await lockOwnBriefing(client, userId, briefingId);

    if (!briefing) {
      return refuse("not-found");
    }

    // briefing_id is in the WHERE as well as the item's own id, so an item belonging to another briefing cannot be edited through the path of one
    // you do own.
    const { rows } = await client.query<ItemRefRow>(
      `UPDATE briefing_items SET note = $3
        WHERE id = $2 AND briefing_id = $1
        RETURNING id, story_id, note, position`,
      [briefingId, itemId, orNull(patch.note)]
    );

    if (!rows[0]) {
      return refuse("not-found");
    }

    await touch(client, briefingId);

    return ok(toItemRef(rows[0]));
  });
}

/**
 * Takes a story out and closes the gap it leaves.
 *
 * Positions stay 1..n, which is what lets "position 1 is the lede" be true rather than approximately true.
 *
 * The gap is closed by one UPDATE that shifts every later position down, and see the note on reorderItems for why that is legal:
 * the constraint being DEFERRABLE is what makes it so, and the SET CONSTRAINTS below is what keeps it legal if this ever becomes two statements.
 */
export async function removeItem(
  userId: number,
  briefingId: number,
  itemId: number
): Promise<Result<{ removed: true }>> {
  return withTransaction(async (client) => {
    const briefing = await lockOwnBriefing(client, userId, briefingId);

    if (!briefing) {
      return refuse("not-found");
    }

    // Both questions in one statement, and both after the lock: is this item in
    // this briefing, and how many are there.
    //
    // The order matters. Checking emptiness first answered 409 "a filed
    // briefing needs at least one story" for an item id that was never there,
    // which is a confusing lie - nothing was at risk of being emptied.
    const { rows: state } = await client.query<{
      present: boolean;
      remaining: number;
    }>(
      `SELECT EXISTS (SELECT 1 FROM briefing_items
                       WHERE id = $2 AND briefing_id = $1) AS present,
              (SELECT count(*)::int FROM briefing_items
                WHERE briefing_id = $1) AS remaining`,
      [briefingId, itemId]
    );

    if (!state[0].present) {
      return refuse("not-found");
    }

    // Publishing refuses an empty briefing, so emptying a published one has to
    // be refused too, or that rule is one DELETE away from meaning nothing.
    if (briefing.status === "published" && state[0].remaining <= 1) {
      return refuse("published-needs-a-story");
    }

    const { rows } = await client.query<{ position: number }>(
      `DELETE FROM briefing_items
        WHERE id = $2 AND briefing_id = $1
        RETURNING position`,
      [briefingId, itemId]
    );

    if (!rows[0]) {
      return refuse("not-found");
    }

    await client.query(
      "SET CONSTRAINTS briefing_items_unique_position DEFERRED"
    );
    await client.query(
      `UPDATE briefing_items SET position = position - 1
        WHERE briefing_id = $1 AND position > $2`,
      [briefingId, rows[0].position]
    );

    await touch(client, briefingId);

    return ok({ removed: true as const });
  });
}

/**
 * Sets the whole order at once.
 *
 * The incoming list has to be exactly this briefing's items, each named once.
 * That is what makes the operation total:
 * there is no partial ordering to reconcile, no position for the server to guess at, and an item from another briefing cannot be smuggled in
 *  - it would not be in the set.
 *
 * A reversal moves every row through a position another row still holds, and what makes that legal is the constraint being declared DEFERRABLE in db/schema.sql:
 * Postgres checks a deferrable unique constraint at the end of the statement, where a plain one is checked as each row is written.
 * Measured both ways - the same UPDATE against a non-deferrable constraint raises 23505 on the second row.
 *
 * So SET CONSTRAINTS below is not what makes this work today, and removing it changes nothing while the rewrite is a single statement.
 * It stays because the moment it is two - a swap written as two UPDATEs is the obvious way somebody edits this - the deferral becomes load-bearing again, and the failure would be a 23505 from a statement that looks obviously correct.
 * tests/schema.test.ts pins the DEFERRABLE keyword itself for the same reason.
 */
export async function reorderItems(
  userId: number,
  briefingId: number,
  itemIds: readonly number[]
): Promise<Result<BriefingItemRef[]>> {
  return withTransaction(async (client) => {
    const briefing = await lockOwnBriefing(client, userId, briefingId);

    if (!briefing) {
      return refuse("not-found");
    }

    const { rows: existing } = await client.query<{ id: number }>(
      "SELECT id FROM briefing_items WHERE briefing_id = $1",
      [briefingId]
    );

    const current = new Set(existing.map((row) => row.id));
    const wanted = new Set(itemIds);

    if (
      wanted.size !== itemIds.length ||
      wanted.size !== current.size ||
      itemIds.some((id) => !current.has(id))
    ) {
      return refuse("ordering-must-match");
    }

    await client.query(
      "SET CONSTRAINTS briefing_items_unique_position DEFERRED"
    );

    // One statement for the whole reorder rather than one per item, the same shape as the wire's bulk upsert.
    // briefing_id is in the WHERE as a second lock on the door:
    // even if the set check above were bypassed, an item belonging to another briefing would not be touched.
    const { rows } = await client.query<ItemRefRow>(
      `UPDATE briefing_items item
          SET position = incoming.position
         FROM UNNEST($2::int[], $3::int[]) AS incoming(id, position)
        WHERE item.id = incoming.id AND item.briefing_id = $1
        RETURNING item.id, item.story_id, item.note, item.position`,
      [briefingId, [...itemIds], itemIds.map((_, index) => index + 1)]
    );

    await touch(client, briefingId);

    // RETURNING gives no order, so the sort happens here rather than in a second SELECT.
    // The set check above proved the UPDATE touched every item in the briefing, so there is no row a read-back could see that this cannot, and n is capped at MAX_BRIEFING_ITEMS.
    return ok(rows.map(toItemRef).sort((a, b) => a.position - b.position));
  });
}
