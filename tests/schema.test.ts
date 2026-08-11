/**
 * Schema constraint tests.
 *
 * The briefings tables have no routes yet, but three constraints carry guarantees the design depends on.
 * Proving them here means a wrong schema is found before an API is built on top of it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { pool } from "../src/db/connection.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

/**
 * Postgres SQLSTATE codes.
 * Asserting on these rather than "it threw" means a test cannot pass because of an unrelated failure such as a typo in the SQL.
 */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INVALID_ENUM_VALUE = "22P02";

/** Asserts a query fails with one specific Postgres error code. */
async function expectPgError(
  query: Promise<unknown>,
  code: string
): Promise<void> {
  await expect(query).rejects.toMatchObject({ code });
}

interface SeededBriefing {
  briefingId: number;
  storyIds: number[];
  itemIds: number[];
}

/** A published briefing with two stories at positions 0 and 1. */
async function seedBriefingWithTwoStories(): Promise<SeededBriefing> {
  const { rows: users } = await pool.query<{ id: number }>(
    `INSERT INTO users (email, username, password_hash)
     VALUES ('curator@example.com', 'curator', 'hash')
     RETURNING id`
  );

  const { rows: stories } = await pool.query<{ id: number }>(
    `INSERT INTO stories (external_id, title, url, published_at)
     VALUES ('ext-1', 'First Story', 'https://example.com/1', now()),
            ('ext-2', 'Second Story', 'https://example.com/2', now())
     RETURNING id`
  );

  const { rows: briefings } = await pool.query<{ id: number }>(
    `INSERT INTO briefings (author_id, title, slug)
     VALUES ($1, 'Morning Briefing', 'morning-briefing-a1b2')
     RETURNING id`,
    [users[0].id]
  );

  const { rows: items } = await pool.query<{ id: number }>(
    `INSERT INTO briefing_items (briefing_id, story_id, position)
     VALUES ($1, $2, 0), ($1, $3, 1)
     RETURNING id`,
    [briefings[0].id, stories[0].id, stories[1].id]
  );

  return {
    briefingId: briefings[0].id,
    storyIds: stories.map((story) => story.id),
    itemIds: items.map((item) => item.id),
  };
}

describe("users indexes", () => {
  it("rejects emails differing only by case", async () => {
    await pool.query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ('Person@example.com', 'person', 'hash')`
    );

    await expectPgError(
      pool.query(
        `INSERT INTO users (email, username, password_hash)
         VALUES ('person@example.com', 'other', 'hash')`
      ),
      UNIQUE_VIOLATION
    );
  });

  it("rejects usernames differing only by case", async () => {
    await pool.query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ('a@example.com', 'Reporter', 'hash')`
    );

    await expectPgError(
      pool.query(
        `INSERT INTO users (email, username, password_hash)
         VALUES ('b@example.com', 'reporter', 'hash')`
      ),
      UNIQUE_VIOLATION
    );
  });
});

describe("stories constraints", () => {
  // tone picks the card a story is drawn as, so a value the frontend has no card for must not be storable in the first place.
  it("rejects a tone outside the enum", async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO stories (external_id, title, url, published_at, tone)
         VALUES ('ext-tone', 'Story', 'https://example.com/t', now(), 'gallery')`
      ),
      INVALID_ENUM_VALUE
    );
  });

  it("defaults a story with no tone to news", async () => {
    const { rows } = await pool.query<{ tone: string }>(
      `INSERT INTO stories (external_id, title, url, published_at)
       VALUES ('ext-default-tone', 'Story', 'https://example.com/d', now())
       RETURNING tone`
    );

    expect(rows[0].tone).toBe("news");
  });
});

describe("briefing_items constraints", () => {
  // The "still renders in a year" guarantee:
  // wire cache cleanup must be physically incapable of breaking a published briefing.
  it("refuses to delete a story referenced by a briefing", async () => {
    const { storyIds } = await seedBriefingWithTwoStories();

    await expectPgError(
      pool.query("DELETE FROM stories WHERE id = $1", [storyIds[0]]),
      FOREIGN_KEY_VIOLATION
    );
  });

  it("allows deleting an unreferenced story", async () => {
    await seedBriefingWithTwoStories();

    await pool.query(
      `INSERT INTO stories (external_id, title, url, published_at)
       VALUES ('ext-3', 'Orphan Story', 'https://example.com/3', now())`
    );

    await pool.query("DELETE FROM stories WHERE external_id = 'ext-3'");

    const { rows } = await pool.query(
      "SELECT id FROM stories WHERE external_id = 'ext-3'"
    );

    expect(rows).toHaveLength(0);
  });

  it("rejects the same story appearing twice in one briefing", async () => {
    const { briefingId, storyIds } = await seedBriefingWithTwoStories();

    await expectPgError(
      pool.query(
        `INSERT INTO briefing_items (briefing_id, story_id, position)
         VALUES ($1, $2, 2)`,
        [briefingId, storyIds[0]]
      ),
      UNIQUE_VIOLATION
    );
  });

  it("allows the same story in two different briefings", async () => {
    const { storyIds } = await seedBriefingWithTwoStories();

    const { rows: users } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, username, password_hash)
       VALUES ('second@example.com', 'second', 'hash')
       RETURNING id`
    );

    const { rows: briefings } = await pool.query<{ id: number }>(
      `INSERT INTO briefings (author_id, title, slug)
       VALUES ($1, 'Evening Briefing', 'evening-briefing-c3d4')
       RETURNING id`,
      [users[0].id]
    );

    await pool.query(
      `INSERT INTO briefing_items (briefing_id, story_id, position)
       VALUES ($1, $2, 0)`,
      [briefings[0].id, storyIds[0]]
    );

    const { rows } = await pool.query(
      "SELECT id FROM briefing_items WHERE briefing_id = $1",
      [briefings[0].id]
    );

    expect(rows).toHaveLength(1);
  });

  // The keyword itself, asserted directly, because measuring what it does turned up something worth pinning:
  // a unique constraint declared DEFERRABLE is checked at the end of the statement, while a plain one is checked as each row is written.
  // So the reorder in briefings.service.ts
  //  - one UPDATE that rewrites every position at once
  // - is legal only because of this word.
  // Take DEFERRABLE out of db/schema.sql and that single statement starts raising 23505 halfway through, which is a long way from where anyone would look.
  // This case names the cause; the reorder route test only shows the symptom.
  it("declares the position constraint deferrable", async () => {
    const { rows } = await pool.query<{ condeferrable: boolean }>(
      `SELECT condeferrable FROM pg_constraint
        WHERE conname = 'briefing_items_unique_position'`
    );

    expect(rows[0]?.condeferrable).toBe(true);
  });

  // Reordering swaps positions, which transiently duplicates one.
  // The constraint must be deferrable or promoting a story to lead is impossible.
  it("allows swapping positions inside a deferred transaction", async () => {
    const { briefingId, itemIds } = await seedBriefingWithTwoStories();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "SET CONSTRAINTS briefing_items_unique_position DEFERRED"
      );
      await client.query(
        "UPDATE briefing_items SET position = 1 WHERE id = $1",
        [itemIds[0]]
      );
      await client.query(
        "UPDATE briefing_items SET position = 0 WHERE id = $1",
        [itemIds[1]]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const { rows } = await pool.query<{ id: number; position: number }>(
      `SELECT id, position FROM briefing_items
       WHERE briefing_id = $1 ORDER BY position`,
      [briefingId]
    );

    // The item that was the lead is now second, and vice versa.
    expect(rows.map((row) => row.id)).toEqual([itemIds[1], itemIds[0]]);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
  });

  it("rejects a duplicate position outside a transaction", async () => {
    const { itemIds } = await seedBriefingWithTwoStories();

    await expectPgError(
      pool.query("UPDATE briefing_items SET position = 0 WHERE id = $1", [
        itemIds[1],
      ]),
      UNIQUE_VIOLATION
    );
  });
});

describe("saved_stories constraints", () => {
  /** One reader with one story decided, returned as ids. */
  async function seedDesk(
    state: "saved" | "skipped" = "saved"
  ): Promise<{ userId: number; storyId: number }> {
    const { rows: users } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, username, password_hash)
       VALUES ('reader@example.com', 'reader', 'hash')
       RETURNING id`
    );

    const { rows: stories } = await pool.query<{ id: number }>(
      `INSERT INTO stories (external_id, title, url, published_at)
       VALUES ('ext-desk', 'A Story', 'https://example.com/desk', now())
       RETURNING id`
    );

    await pool.query(
      `INSERT INTO saved_stories (user_id, story_id, state)
       VALUES ($1, $2, $3)`,
      [users[0].id, stories[0].id, state]
    );

    return { userId: users[0].id, storyId: stories[0].id };
  }

  // The constraint the whole concept rests on.
  // Cache cleanup must be physically incapable of emptying somebody's desk.
  it("refuses to delete a story someone has saved", async () => {
    const { storyId } = await seedDesk("saved");

    await expectPgError(
      pool.query("DELETE FROM stories WHERE id = $1", [storyId]),
      FOREIGN_KEY_VIOLATION
    );
  });

  // Documented rather than desired:
  // a foreign key cannot be conditional on a column, so RESTRICT covers skipped rows too.
  // Pruning stale stories means clearing their skipped rows first, and this is where that is written down.
  it("also refuses to delete a story someone has skipped", async () => {
    const { storyId } = await seedDesk("skipped");

    await expectPgError(
      pool.query("DELETE FROM stories WHERE id = $1", [storyId]),
      FOREIGN_KEY_VIOLATION
    );
  });

  it("removes a reader's desk when the reader is deleted", async () => {
    const { userId } = await seedDesk();

    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    const { rows } = await pool.query(
      "SELECT id FROM saved_stories WHERE user_id = $1",
      [userId]
    );

    expect(rows).toHaveLength(0);
  });

  // What makes the write idempotent:
  // one decision per reader per story, so an upsert has a single row to land on.
  it("rejects the same story twice on one desk", async () => {
    const { userId, storyId } = await seedDesk();

    await expectPgError(
      pool.query(
        `INSERT INTO saved_stories (user_id, story_id, state)
         VALUES ($1, $2, 'skipped')`,
        [userId, storyId]
      ),
      UNIQUE_VIOLATION
    );
  });

  it("allows the same story on two readers' desks", async () => {
    const { storyId } = await seedDesk();

    const { rows: users } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, username, password_hash)
       VALUES ('second@example.com', 'second', 'hash')
       RETURNING id`
    );

    await pool.query(
      `INSERT INTO saved_stories (user_id, story_id, state)
       VALUES ($1, $2, 'skipped')`,
      [users[0].id, storyId]
    );

    const { rows } = await pool.query(
      "SELECT id FROM saved_stories WHERE story_id = $1",
      [storyId]
    );

    expect(rows).toHaveLength(2);
  });

  it("rejects a state outside the enum", async () => {
    const { userId } = await seedDesk();

    await expectPgError(
      pool.query(
        "UPDATE saved_stories SET state = 'filed' WHERE user_id = $1",
        [userId]
      ),
      INVALID_ENUM_VALUE
    );
  });
});

describe("briefings constraints", () => {
  it("defaults new briefings to draft", async () => {
    const { briefingId } = await seedBriefingWithTwoStories();

    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM briefings WHERE id = $1",
      [briefingId]
    );

    expect(rows[0].status).toBe("draft");
  });

  it("rejects a status outside the enum", async () => {
    const { briefingId } = await seedBriefingWithTwoStories();

    await expectPgError(
      pool.query("UPDATE briefings SET status = 'archived' WHERE id = $1", [
        briefingId,
      ]),
      INVALID_ENUM_VALUE
    );
  });

  it("rejects a duplicate slug", async () => {
    await seedBriefingWithTwoStories();

    const { rows: users } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, username, password_hash)
       VALUES ('third@example.com', 'third', 'hash')
       RETURNING id`
    );

    await expectPgError(
      pool.query(
        `INSERT INTO briefings (author_id, title, slug)
         VALUES ($1, 'Different Title', 'morning-briefing-a1b2')`,
        [users[0].id]
      ),
      UNIQUE_VIOLATION
    );
  });

  it("removes a user's briefings and items when the user is deleted", async () => {
    const { briefingId } = await seedBriefingWithTwoStories();

    await pool.query("DELETE FROM users WHERE username = 'curator'");

    const { rows: briefings } = await pool.query(
      "SELECT id FROM briefings WHERE id = $1",
      [briefingId]
    );
    const { rows: items } = await pool.query(
      "SELECT id FROM briefing_items WHERE briefing_id = $1",
      [briefingId]
    );

    expect(briefings).toHaveLength(0);
    expect(items).toHaveLength(0);
  });
});
