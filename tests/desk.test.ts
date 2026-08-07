/**
 * Desk endpoint tests.
 *
 * The security cases carry the most weight here, and they are the reason this phase is reviewed:
 * /api/desk is the first endpoint in this project where one account can name a row belonging to another.
 * Every one of them asserts what survived in the database, not only what the response said;
 * a handler that writes to the wrong user and then reports the right one would pass a response-only check.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { pool } from "../src/db/connection.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { get, put, del, registerAndLogin } from "./helpers/request.js";
import {
  MAX_STORY_ID,
  MAX_MERGE_ENTRIES,
  MAX_WINDOW_DAYS,
} from "../src/modules/desk/desk.schema.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

/**
 * A window wide enough to hold anything a test seeds.
 *
 * The full read requires one, so a case that is not about windowing asks for a day either side of now rather than omitting it.
 * Cases that ARE about windowing build their own bounds.
 */
const WHOLE_DAY = new URLSearchParams({
  from: new Date(Date.now() - 86_400_000).toISOString(),
  to: new Date(Date.now() + 86_400_000).toISOString(),
}).toString();

/** Inserts `count` stories and returns their ids, oldest first. */
async function seedStories(count = 3): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO stories (external_id, title, url, published_at)
     SELECT 'ext-' || n,
            'Story ' || n,
            'https://example.com/' || n,
            now() - make_interval(mins => n)
       FROM generate_series(1, $1) AS n
     RETURNING id`,
    [count]
  );

  return rows.map((row) => row.id);
}

/** Every saved_stories row, so a test can assert on what actually landed. */
async function deskRows(): Promise<
  { user_id: number; story_id: number; state: string }[]
> {
  const { rows } = await pool.query(
    `SELECT user_id, story_id, state FROM saved_stories
      ORDER BY user_id, story_id`
  );

  return rows;
}

describe("desk authentication", () => {
  // The whole sub-app sits behind one authMiddleware registration.
  // These four prove it is actually wired, which a per-route check could not:
  // the failure this guards against is a new route added outside the protected group.
  it("refuses every route without a token", async () => {
    const storyIds = await seedStories(1);

    const responses = await Promise.all([
      get("/api/desk"),
      put(`/api/desk/${storyIds[0]}`, { state: "saved" }),
      del(`/api/desk/${storyIds[0]}`),
      put("/api/desk", { entries: [] }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it("refuses a token signed with the wrong secret", async () => {
    const forged =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJ1c2VySWQiOjEsImVtYWlsIjoiYUBiLmMiLCJ1c2VybmFtZSI6ImEifQ." +
      "not-a-real-signature";

    const response = await get("/api/desk", forged);

    expect(response.status).toBe(401);
  });
});

describe("recording a decision", () => {
  it("saves a story and returns it on the desk", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const write = await put(
      `/api/desk/${storyId}`,
      { state: "saved" },
      reader.token
    );

    expect(write.status).toBe(200);
    expect(write.body.entry).toMatchObject({ storyId, state: "saved" });

    const read = await get(`/api/desk?${WHOLE_DAY}`, reader.token);

    expect(read.status).toBe(200);
    expect(read.body.total).toBe(1);
    expect(read.body.entries[0]).toMatchObject({ storyId, state: "saved" });
  });

  it("carries the whole story, not just its id", async () => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO stories
         (external_id, title, summary, standfirst, byline, url, section,
          pillar, tone, word_count, star_rating, thumbnail_url, image_url,
          image_alt, image_credit, published_at)
       VALUES ('ext-full', 'Full Story', 'A summary', 'A standfirst',
               'By Someone', 'https://example.com/full', 'World', 'News',
               'features', 900, 4, 'https://img/500.jpg',
               'https://img/1000.jpg', 'Alt text', 'Photo credit', now())
       RETURNING id`
    );
    const storyId = rows[0].id;
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${storyId}`, { state: "saved" }, reader.token);
    const read = await get(`/api/desk?${WHOLE_DAY}`, reader.token);

    // The desk is what phase 7 renders, so it needs the same fields the wire serves rather than a thinner shape that would need a second request.
    expect(read.body.entries[0].story).toMatchObject({
      id: storyId,
      title: "Full Story",
      standfirst: "A standfirst",
      byline: "By Someone",
      pillar: "News",
      tone: "features",
      wordCount: 900,
      starRating: 4,
      imageUrl: "https://img/1000.jpg",
      imageAlt: "Alt text",
    });
  });

  // The row count alone proves nothing here:
  // the unique constraint guarantees it whatever the handler does, so this passed with ON  CONFLICT deleted and the second write returning a 500.
  // Both writes have to be seen to succeed.
  it("is idempotent - the same decision twice leaves one row", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const first = await put(
      `/api/desk/${storyId}`,
      { state: "saved" },
      reader.token
    );
    const second = await put(
      `/api/desk/${storyId}`,
      { state: "saved" },
      reader.token
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(await deskRows()).toHaveLength(1);
  });

  it("replaces a decision rather than adding a second", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${storyId}`, { state: "saved" }, reader.token);
    await put(`/api/desk/${storyId}`, { state: "skipped" }, reader.token);

    const rows = await deskRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("skipped");
  });

  it("returns 404 for a story that is not on the wire", async () => {
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk/999999",
      { state: "saved" },
      reader.token
    );

    expect(response.status).toBe(404);
    expect(await deskRows()).toHaveLength(0);
  });
});

describe("removing a decision", () => {
  it("takes a story back off the desk", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${storyId}`, { state: "saved" }, reader.token);
    const removal = await del(`/api/desk/${storyId}`, reader.token);

    expect(removal.status).toBe(200);
    expect(removal.body.removed).toBe(true);
    expect(await deskRows()).toHaveLength(0);
  });

  // Undo on a decision that never reached the server is the ordinary way to get here, so it states the end state rather than reporting a failure.
  it("treats removing an undecided story as success", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const response = await del(`/api/desk/${storyId}`, reader.token);

    expect(response.status).toBe(200);
    expect(response.body.removed).toBe(false);
  });
});

describe("filtering", () => {
  it("returns only the requested state", async () => {
    const [saved, skipped] = await seedStories(2);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${saved}`, { state: "saved" }, reader.token);
    await put(`/api/desk/${skipped}`, { state: "skipped" }, reader.token);

    const all = await get(`/api/desk?${WHOLE_DAY}`, reader.token);
    const onlySaved = await get(
      `/api/desk?${WHOLE_DAY}&state=saved`,
      reader.token
    );

    // Unfiltered includes skips on purpose: the deck cannot avoid re-dealing a dismissed story unless the server tells it which ones those are.
    expect(all.body.total).toBe(2);
    expect(onlySaved.body.total).toBe(1);
    expect(onlySaved.body.entries[0].storyId).toBe(saved);
  });

  // Flipping the ORDER BY to ASC left every desk test green.
  // The desk is a dated edition and phase 7 draws it in this order, so it is worth an assertion of its own.
  it("returns the newest decision first", async () => {
    const [first, second] = await seedStories(2);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${first}`, { state: "saved" }, reader.token);
    await put(`/api/desk/${second}`, { state: "saved" }, reader.token);

    const read = await get(`/api/desk?${WHOLE_DAY}`, reader.token);

    expect(
      read.body.entries.map((entry: { storyId: number }) => entry.storyId)
    ).toEqual([second, first]);
  });

  it("rejects a state outside the two", async () => {
    const reader = await registerAndLogin("reader@example.com");

    const response = await get(
      `/api/desk?${WHOLE_DAY}&state=filed`,
      reader.token
    );

    expect(response.status).toBe(400);
  });
});

/**
 * The window is what makes the full read bounded, so these are the cases that keep it that way.
 * Without them the parameter could be quietly dropped and every other desk test would still pass.
 */
describe("one edition at a time", () => {
  /** Puts an existing decision at a chosen instant. */
  async function decidedAt(storyId: number, when: Date): Promise<void> {
    await pool.query(
      "UPDATE saved_stories SET decided_at = $2 WHERE story_id = $1",
      [storyId, when]
    );
  }

  it("returns only the decisions inside the window", async () => {
    const [today, yesterday] = await seedStories(2);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${today}`, { state: "saved" }, reader.token);
    await put(`/api/desk/${yesterday}`, { state: "saved" }, reader.token);
    await decidedAt(yesterday, new Date(Date.now() - 86_400_000));

    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const read = await get(
      `/api/desk?${new URLSearchParams({ from, to })}`,
      reader.token
    );

    expect(read.status).toBe(200);
    expect(read.body.total).toBe(1);
    expect(read.body.entries[0].storyId).toBe(today);
  });

  // from is inclusive and to is exclusive, which is the only pair of rules under which two consecutive days cannot both claim the same story.
  it("includes a decision exactly on `from` and excludes one on `to`", async () => {
    const [onFrom, onTo] = await seedStories(2);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${onFrom}`, { state: "saved" }, reader.token);
    await put(`/api/desk/${onTo}`, { state: "saved" }, reader.token);

    const from = new Date("2026-08-06T00:00:00.000Z");
    const to = new Date("2026-08-07T00:00:00.000Z");
    await decidedAt(onFrom, from);
    await decidedAt(onTo, to);

    const read = await get(
      `/api/desk?${new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      })}`,
      reader.token
    );

    expect(
      read.body.entries.map((e: { storyId: number }) => e.storyId)
    ).toEqual([onFrom]);
  });

  it("refuses the full form without a window", async () => {
    const reader = await registerAndLogin("reader@example.com");

    const response = await get("/api/desk", reader.token);

    expect(response.status).toBe(400);
  });

  // compact is a few dozen bytes per decision and the archive strip needs every day at once, so it is the one form that stays unranged.
  it("still allows the compact form without a window", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${storyId}`, { state: "saved" }, reader.token);
    const read = await get("/api/desk?view=compact", reader.token);

    expect(read.status).toBe(200);
    expect(read.body.total).toBe(1);
    expect(read.body.entries[0].story).toBeUndefined();
  });

  it("rejects a half-open window, a malformed instant and a reversed pair", async () => {
    const reader = await registerAndLogin("reader@example.com");
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 3_600_000).toISOString();

    const responses = await Promise.all([
      get(`/api/desk?from=${encodeURIComponent(now)}`, reader.token),
      get(`/api/desk?to=${encodeURIComponent(now)}`, reader.token),
      get(
        `/api/desk?from=yesterday&to=${encodeURIComponent(now)}`,
        reader.token
      ),
      get(
        `/api/desk?${new URLSearchParams({ from: now, to: earlier })}`,
        reader.token
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });

  // Zod's datetime() is looser than timestamptz in two ways, and Date.parse accepts both, so comparing the two bounds catches neither:
  // Postgres has no year zero (22008) and rejects offsets past +/-15:59 (22009).
  // Left alone each is a 500 from a value anyone can type in the URL bar;@
  // the same trap as the unbounded `page` the 2026-07-28 audit fixed on the wire.
  //
  // The two classes are handled differently on purpose.
  // An impossible year is refused; an extreme offset is a real instant written oddly, so it is normalised to UTC and served rather than rejected.
  it("refuses an instant Postgres has no year for", async () => {
    const reader = await registerAndLogin("reader@example.com");

    // Both bounds sit inside the impossible range, so the window is only a day wide.
    // Without that the span cap rejects these first and the case passes while proving nothing about the epoch floor;
    // which is exactly what it did on the first attempt.
    const responses = await Promise.all(
      [
        ["0000-01-01T00:00:00Z", "0000-01-02T00:00:00Z"],
        ["1969-12-31T00:00:00Z", "1969-12-31T23:00:00Z"],
      ].map(([from, to]) =>
        get(`/api/desk?${new URLSearchParams({ from, to })}`, reader.token)
      )
    );

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });

  it("normalises an out-of-range offset rather than handing it to Postgres", async () => {
    const reader = await registerAndLogin("reader@example.com");

    // +16:00 is past what Postgres accepts, but each of these names a real instant and they are 24 hours apart, so the request is legal once they are converted.
    // A 200 proves conversion; the unfixed code answered 500.
    const response = await get(
      `/api/desk?${new URLSearchParams({
        from: "2026-08-06T00:00:00+16:00",
        to: "2026-08-07T00:00:00+16:00",
      })}`,
      reader.token
    );

    expect(response.status).toBe(200);
  });

  // Requiring a window is not the same as bounding one:
  // without the cap, one request still returns every story body on the desk.
  it("refuses a window wider than the cap", async () => {
    const reader = await registerAndLogin("reader@example.com");
    const from = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const to = new Date().toISOString();

    const response = await get(
      `/api/desk?${new URLSearchParams({ from, to })}`,
      reader.token
    );

    expect(response.status).toBe(400);
  });

  it("accepts a window exactly at the cap", async () => {
    const reader = await registerAndLogin("reader@example.com");
    const to = new Date();
    const from = new Date(to.getTime() - MAX_WINDOW_DAYS * 86_400_000);

    const response = await get(
      `/api/desk?${new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      })}`,
      reader.token
    );

    expect(response.status).toBe(200);
  });

  // The window must narrow a desk, never widen access to someone else's.
  it("still cannot reach another reader's decisions inside a window", async () => {
    const [storyId] = await seedStories(1);
    const a = await registerAndLogin("a@example.com", "alpha");
    const b = await registerAndLogin("b@example.com", "bravo");

    await put(`/api/desk/${storyId}`, { state: "saved" }, b.token);

    const read = await get(`/api/desk?${WHOLE_DAY}`, a.token);

    expect(read.status).toBe(200);
    expect(read.body.total).toBe(0);
  });
});

describe("one reader cannot reach another's desk", () => {
  it("does not show B's decisions to A", async () => {
    const [storyId] = await seedStories(1);
    const a = await registerAndLogin("a@example.com", "alpha");
    const b = await registerAndLogin("b@example.com", "bravo");

    await put(`/api/desk/${storyId}`, { state: "saved" }, b.token);

    const read = await get(`/api/desk?${WHOLE_DAY}`, a.token);

    expect(read.body.total).toBe(0);
    expect(read.body.entries).toEqual([]);
  });

  it("does not let A delete B's entry", async () => {
    const [storyId] = await seedStories(1);
    const a = await registerAndLogin("a@example.com", "alpha");
    const b = await registerAndLogin("b@example.com", "bravo");

    await put(`/api/desk/${storyId}`, { state: "saved" }, b.token);
    const removal = await del(`/api/desk/${storyId}`, a.token);

    // Identical to deleting something nobody decided, so the answer cannot be used to find out what another reader has saved.
    expect(removal.status).toBe(200);
    expect(removal.body.removed).toBe(false);

    const rows = await deskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(b.userId);
  });

  it("does not let A overwrite B's decision", async () => {
    const [storyId] = await seedStories(1);
    const a = await registerAndLogin("a@example.com", "alpha");
    const b = await registerAndLogin("b@example.com", "bravo");

    await put(`/api/desk/${storyId}`, { state: "saved" }, b.token);
    await put(`/api/desk/${storyId}`, { state: "skipped" }, a.token);

    const rows = await deskRows();

    // Two rows, one each. The unique constraint is on (user_id, story_id), so the same story on two desks is two independent decisions.
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.user_id === b.userId)?.state).toBe("saved");
    expect(rows.find((row) => row.user_id === a.userId)?.state).toBe("skipped");
  });

  // The successor to the submitted_by guarantee: the body is not evidence.
  it("ignores a user id in the body and writes to the token's owner", async () => {
    const [storyId] = await seedStories(1);
    const a = await registerAndLogin("a@example.com", "alpha");
    const b = await registerAndLogin("b@example.com", "bravo");

    await put(
      `/api/desk/${storyId}`,
      { state: "saved", userId: b.userId, user_id: b.userId },
      a.token
    );

    const rows = await deskRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(a.userId);
  });

  it("ignores a user id in the merge body too", async () => {
    const [storyId] = await seedStories(1);
    const a = await registerAndLogin("a@example.com", "alpha");
    const b = await registerAndLogin("b@example.com", "bravo");

    await put(
      "/api/desk",
      { userId: b.userId, entries: [{ storyId, state: "saved" }] },
      a.token
    );

    const rows = await deskRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(a.userId);
  });

  it("never puts an email on a desk response", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${storyId}`, { state: "saved" }, reader.token);
    const read = await get(`/api/desk?${WHOLE_DAY}`, reader.token);

    // Without the status check this passes on a 500, whose body mentions no email either.
    expect(read.status).toBe(200);
    expect(read.body.total).toBe(1);
    expect(JSON.stringify(read.body)).not.toContain("reader@example.com");
  });
});

describe("story id validation", () => {
  // Every bound below is expressed as MAX_STORY_ID + 1, so all of them stay green if the constant itself is wrong.
  // This is the one assertion that pins it to the actual limit of a Postgres integer column.
  it("bounds story ids at the largest a Postgres integer holds", () => {
    expect(MAX_STORY_ID).toBe(2_147_483_647);
  });

  // An id past int4 reaches Postgres as an out-of-range value and comes back as a 500 from something anyone can type in the URL bar.
  // Same trap as the unbounded page number on the wire.
  const rejected = [
    ["not a number", "abc"],
    ["zero", "0"],
    ["a fraction", "1.5"],
    ["past the integer column", String(MAX_STORY_ID + 1)],
  ] as const;

  for (const [name, value] of rejected) {
    it(`rejects ${name} on a write`, async () => {
      const reader = await registerAndLogin("reader@example.com");

      const response = await put(
        `/api/desk/${value}`,
        { state: "saved" },
        reader.token
      );

      expect(response.status).toBe(400);
    });

    it(`rejects ${name} on a delete`, async () => {
      const reader = await registerAndLogin("reader@example.com");

      const response = await del(`/api/desk/${value}`, reader.token);

      expect(response.status).toBe(400);
    });
  }

  it("rejects a decision outside the two states", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      `/api/desk/${storyId}`,
      { state: "filed" },
      reader.token
    );

    expect(response.status).toBe(400);
    expect(await deskRows()).toHaveLength(0);
  });
});

describe("merging a signed-out session", () => {
  it("writes every decision in one request", async () => {
    const [first, second, third] = await seedStories(3);
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk",
      {
        entries: [
          { storyId: first, state: "saved" },
          { storyId: second, state: "skipped" },
          { storyId: third, state: "saved" },
        ],
      },
      reader.token
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ merged: 3, dropped: 0 });
    expect(await deskRows()).toHaveLength(3);
  });

  // The session was made moments ago; anything already on the desk for the same story was decided on an earlier visit.
  it("lets the incoming session win on a conflict", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    await put(`/api/desk/${storyId}`, { state: "skipped" }, reader.token);
    await put(
      "/api/desk",
      { entries: [{ storyId, state: "saved" }] },
      reader.token
    );

    const rows = await deskRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("saved");
  });

  // A session outlives the wire page it was made against.
  // Losing the whole migration because one story aged out would be the worst possible trade.
  it("drops stories that have left the cache without failing the batch", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk",
      {
        entries: [
          { storyId, state: "saved" },
          { storyId: 999999, state: "saved" },
        ],
      },
      reader.token
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ merged: 1, dropped: 1 });
    expect(await deskRows()).toHaveLength(1);
  });

  // ON CONFLICT DO UPDATE refuses to touch one row twice in a statement, so a body naming a story twice would be a 500 without deduplication.
  it("survives the same story named twice, last mention winning", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk",
      {
        entries: [
          { storyId, state: "saved" },
          { storyId, state: "skipped" },
        ],
      },
      reader.token
    );

    expect(response.status).toBe(200);

    const rows = await deskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("skipped");
  });

  it("accepts an empty session", async () => {
    const reader = await registerAndLogin("reader@example.com");

    const response = await put("/api/desk", { entries: [] }, reader.token);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ merged: 0, dropped: 0 });
  });

  // The merge body has its own bounds and every existing case exercised the path validator instead, so `z.number()` with no .int().max() passed all of them.
  // The float is the dangerous one:
  // UNNEST(ARRAY[1.5]::int[]) rounds to 2 in Postgres, so a decision would be written against a different story than the one named, with a 200 and nothing logged.
  it("rejects a fractional story id in a merge, and writes nothing", async () => {
    const [storyId] = await seedStories(2);
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk",
      { entries: [{ storyId: storyId + 0.5, state: "saved" }] },
      reader.token
    );

    expect(response.status).toBe(400);
    expect(await deskRows()).toHaveLength(0);
  });

  it("rejects a story id past the integer column in a merge", async () => {
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk",
      { entries: [{ storyId: MAX_STORY_ID + 1, state: "saved" }] },
      reader.token
    );

    expect(response.status).toBe(400);
  });

  it("rejects a state outside the two in a merge", async () => {
    const [storyId] = await seedStories(1);
    const reader = await registerAndLogin("reader@example.com");

    const response = await put(
      "/api/desk",
      { entries: [{ storyId, state: "filed" }] },
      reader.token
    );

    expect(response.status).toBe(400);
    expect(await deskRows()).toHaveLength(0);
  });

  it("rejects a batch past the cap", async () => {
    const reader = await registerAndLogin("reader@example.com");

    const entries = Array.from(
      { length: MAX_MERGE_ENTRIES + 1 },
      (_unused, index) => ({ storyId: index + 1, state: "saved" as const })
    );

    const response = await put("/api/desk", { entries }, reader.token);

    expect(response.status).toBe(400);
  });
});
