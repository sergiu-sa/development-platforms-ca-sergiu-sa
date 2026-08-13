/**
 * Rows to test against.
 *
 * Two briefings test files grew their own copy of this, each with its own external-id counter and its own idea of which columns a story has.
 * Four descriptions of "what a stories row looks like" across the suite is four edits the next time the table gains a NOT NULL column, and the copies that lack the counter fail differently from the ones that have it.
 *
 * tests/desk.test.ts still has its own, deliberately left alone
 *  - it is not part of the change this helper was written for, and switching a passing test file to prove a point is how a refactor breaks something for nothing.
 * It can adopt this the next time it is touched.
 */

import { expect } from "vitest";
import { pool } from "../../src/db/connection.js";
import { patch, post } from "./request.js";

/**
 * How many stories have been seeded in this process so far.
 *
 * external_id is unique, so a test that seeds twice needs the second batch to carry different ones.
 * The counter never resets, which is harmless:
 * truncation between tests takes the rows away, and only the names have to stay distinct within a single test.
 */
let seeded = 0;

/**
 * Inserts `count` stories and returns their ids, **newest first**:
 * story n is published n minutes ago, so the first id returned is the most recent.
 *
 * Worth stating precisely, because the comment used to say the opposite and nothing depended on it.
 * The first test written about ordering on top of a wrong sentence would have looked like an implementation bug.
 *
 * Every optional column is filled.
 * They are all nullable, so a test that only wants ids is unaffected by getting them, and a test that renders a story does not need a second seeder to get a byline.
 */
export async function seedStories(count = 3): Promise<number[]> {
  const offset = seeded;
  seeded += count;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO stories
       (external_id, title, summary, standfirst, byline, url, section, pillar,
        word_count, thumbnail_url, image_url, image_alt, published_at)
     SELECT 'seed-' || (n + $2),
            'Story ' || n,
            'A summary',
            'A standfirst',
            'A Reporter',
            'https://example.com/' || n,
            'World news',
            'News',
            460,
            'https://media.guim.co.uk/' || n || '/500.jpg',
            'https://media.guim.co.uk/' || n || '/1000.jpg',
            'A photograph',
            now() - make_interval(mins => n)
       FROM generate_series(1, $1) AS n
     RETURNING id`,
    [count, offset]
  );

  return rows.map((row) => row.id);
}

/**
 * A briefing with one story, filed unless `file` says otherwise.
 *
 * Lived in `briefings-read.test.ts` until the page route needed the same thing.
 * Moved here rather than copied, for the reason at the top of this file:
 * a third description of "how a briefing gets made" is a third edit every time the write path changes, and the copies drift apart quietly.
 *
 * Each step is asserted rather than assumed. Unchecked, a regression in the write path surfaces as an undefined slug three tests later, naming the wrong thing.
 */
export async function fileBriefing(
  token: string,
  title: string,
  options: { file?: boolean; note?: string } = {}
) {
  const created = await post("/api/briefings", { title }, token);
  expect(created.status).toBe(201);
  const briefing = created.body.briefing;
  const [storyId] = await seedStories(1);

  const added = await post(
    `/api/briefings/${briefing.id}/items`,
    { storyId, note: options.note ?? "Why this matters" },
    token
  );
  expect(added.status).toBe(201);

  if (options.file !== false) {
    const filed = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );
    expect(filed.status).toBe(200);

    return { ...filed.body.briefing, storyId };
  }

  return { ...briefing, storyId };
}
