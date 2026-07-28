/**
 * Schema constraint tests.
 *
 * The briefings tables have no routes yet, but three constraints carry
 * guarantees the design depends on. Proving them here means a wrong schema is
 * found before an API is built on top of it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { pool } from "../src/db/connection.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

/**
 * Postgres SQLSTATE codes. Asserting on these rather than "it threw" means a
 * test cannot pass because of an unrelated failure such as a typo in the SQL.
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

describe("briefing_items constraints", () => {
  // The "still renders in a year" guarantee: wire cache cleanup must be
  // physically incapable of breaking a published briefing.
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

  // Reordering swaps positions, which transiently duplicates one. The
  // constraint must be deferrable or promoting a story to lead is impossible.
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
