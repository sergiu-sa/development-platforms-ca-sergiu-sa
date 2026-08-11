/**
 * Briefing write tests.
 *
 * The ownership cases carry the most weight and are the reason this phase is reviewed.
 * /api/briefings is the second place one account can name another account's row, and the first where the row is something the owner published under their own name.
 *
 * Every security case asserts what survived in the database, not only what the response said.
 * A handler that writes to the wrong briefing and then reports the right one would pass a response-only check.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { pool } from "../src/db/connection.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { seedStories } from "./helpers/seed.js";
import {
  get,
  post,
  patch,
  put,
  del,
  head,
  registerAndLogin,
} from "./helpers/request.js";
import { createBriefing } from "../src/modules/briefings/briefings.service.js";
import {
  briefingRoutes,
  publicBriefingRoutes,
} from "../src/modules/briefings/briefings.route.js";
import {
  MAX_ID,
  MAX_BRIEFING_ITEMS,
  TITLE_MIN,
  TITLE_MAX,
  INTRO_MAX,
  NOTE_MAX,
} from "../src/modules/briefings/briefings.schema.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

async function startDraft(token: string, title = "Morning Briefing") {
  const response = await post("/api/briefings", { title }, token);

  expect(response.status).toBe(201);

  return response.body.briefing as {
    id: number;
    slug: string;
    title: string;
    status: string;
    publishedAt: string | null;
    itemCount: number;
    author: { username: string };
  };
}

async function addStory(
  token: string,
  briefingId: number,
  storyId: number,
  note?: string
) {
  const response = await post(
    `/api/briefings/${briefingId}/items`,
    note === undefined ? { storyId } : { storyId, note },
    token
  );

  expect(response.status).toBe(201);

  return response.body.item as {
    id: number;
    storyId: number;
    note: string | null;
    position: number;
  };
}

/** Every item of a briefing straight out of the database, in order. */
async function itemRows(briefingId: number) {
  const { rows } = await pool.query<{
    id: number;
    story_id: number;
    note: string | null;
    position: number;
  }>(
    `SELECT id, story_id, note, position FROM briefing_items
      WHERE briefing_id = $1 ORDER BY position`,
    [briefingId]
  );

  return rows;
}

describe("briefing authentication", () => {
  // Publicness is declared by which router a route sits in, so these prove the private one is behind its blanket middleware:
  // a write that reached a handler without a token would be a route declared on the wrong router, which is what the desk's equivalent case guards against one module along.
  it("refuses every write without a token", async () => {
    const responses = await Promise.all([
      post("/api/briefings", { title: "No token" }),
      patch("/api/briefings/1", { title: "No token" }),
      del("/api/briefings/1"),
      post("/api/briefings/1/items", { storyId: 1 }),
      patch("/api/briefings/1/items/1", { note: "hello" }),
      del("/api/briefings/1/items/1"),
      put("/api/briefings/1/items", { itemIds: [1] }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
    }

    const { rows } = await pool.query("SELECT id FROM briefings");
    expect(rows).toHaveLength(0);
  });

  it("refuses a token signed with the wrong secret", async () => {
    const forged = jwt.sign(
      { userId: 1, email: "a@example.com", username: "a" },
      "not-the-secret"
    );

    const response = await post("/api/briefings", { title: "Forged" }, forged);

    expect(response.status).toBe(401);
  });

  it("serves the public reads with no token at all", async () => {
    const listing = await get("/api/briefings");

    expect(listing.status).toBe(200);
    expect(listing.body.briefings).toEqual([]);
  });

  // A public read must not bounce somebody whose week-old session expired.
  // optionalAuth treats a token it cannot verify as no token, and this is the case that says so.
  it("ignores an unverifiable token on a public read rather than refusing it", async () => {
    const forged = jwt.sign(
      { userId: 1, email: "a@example.com", username: "a" },
      "not-the-secret"
    );

    const response = await get("/api/briefings", forged);

    expect(response.status).toBe(200);
  });

  // optionalAuth makes two promises, and the case above only pins the lenient one.
  // This pins the other:
  // a token it cannot verify must not be *adopted*.
  //
  // It has to run against /:slug rather than the listing, because the listing never reads the viewer
  //  - it would answer 200 to a token-shaped string.
  // Here the forged token carries the draft owner's real id, so if verification were ever weakened to a decode, this returns 200 and B's unpublished work is readable by anyone who can guess a user id.
  it("does not adopt the identity inside a token it cannot verify", async () => {
    const owner = await registerAndLogin("forge-target@example.com");
    const draft = await startDraft(owner.token, "Not published yet");

    const forged = jwt.sign(
      {
        userId: owner.userId,
        email: "forge-target@example.com",
        username: owner.username,
      },
      "not-the-secret"
    );

    const asOwner = await get(`/api/briefings/${draft.slug}`, owner.token);
    const asForger = await get(`/api/briefings/${draft.slug}`, forged);

    expect(asOwner.status).toBe(200);
    expect(asForger.status).toBe(404);
  });

  // The hazard the route file's header warns about, made into a failure.
  //
  // Both routers are mounted on /api/briefings and the public one goes first, which it must
  //  - the private router's blanket middleware would otherwise 401 the public reads.
  // The cost is that `GET /:slug` matches any single segment before the private router is consulted, so a private read added there is answered by the public handler instead of being protected.
  //
  // It fails closed, so it is not a security hole; it is a silent one.
  // The author sees a 404 that reads like a missing briefing and has no reason to suspect the router.
  // A comment cannot catch that. This can.
  //
  // The public patterns are derived rather than hardcoded, so widening the public router keeps the check honest instead of quietly narrowing it.
  it("has no private read that the public router would swallow", () => {
    const shadows = publicBriefingRoutes.routes
      .filter((route) => route.method === "GET")
      .map(
        (route) => new RegExp(`^${route.path.replace(/:[^/]+/g, "[^/]+")}$`)
      );

    // If this is ever empty the check below passes for nothing.
    // And the patterns have to actually match something:
    // /mine is the realistic next addition, and a pattern that matched nothing would sail through on the one day this test exists for.
    expect(shadows.length).toBeGreaterThan(0);
    expect(shadows.some((shadow) => shadow.test("/mine"))).toBe(true);

    const swallowed = briefingRoutes.routes
      .filter((route) => route.method === "GET")
      .map((route) => route.path)
      .filter((path) => shadows.some((shadow) => shadow.test(path)));

    expect(
      [...new Set(swallowed)],
      "These GET routes are on the private briefings router, but the public " +
        "router is mounted first and already matches their paths, so the " +
        "public handler answers instead and the private one never runs - " +
        "with no token required and no error to say so. Give the route a " +
        "path the public router does not match (two segments will do), or " +
        "mount it under its own prefix."
    ).toEqual([]);
  });

  // The first version of this module decided auth by testing c.req.method.
  // Hono re-dispatches HEAD through the GET handler chain while the method still reads "HEAD", so every HEAD on a public read answered 401
  // - a link checker or an uptime monitor would have seen a broken site.
  // Nothing else in the suite exercises HEAD, so without this case the fix has no guard.
  // A public front page must not 401 because somebody typed a trailing slash.
  // The second half is the one that matters:
  // loosening the match must not loosen the guard, so a write at the same path is still refused.
  it("treats a trailing slash as the same route, on both routers", async () => {
    const listing = await get("/api/briefings/");
    const write = await post("/api/briefings/", { title: "No token" });

    expect(listing.status).toBe(200);
    expect(write.status).toBe(401);
  });

  it("answers HEAD on the public reads the way it answers GET", async () => {
    const { token } = await registerAndLogin("head@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token, "Filed and public");
    await addStory(token, briefing.id, storyId);
    await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );

    expect((await head("/api/briefings")).status).toBe(200);
    expect((await head(`/api/briefings/${briefing.slug}`)).status).toBe(200);
  });
});

describe("starting a briefing", () => {
  it("creates a draft with an address derived from the title", async () => {
    const { token, username } = await registerAndLogin("start@example.com");

    const briefing = await startDraft(token, "Weekly Climate Roundup");

    expect(briefing.status).toBe("draft");
    expect(briefing.publishedAt).toBeNull();
    expect(briefing.itemCount).toBe(0);
    expect(briefing.author).toEqual({ username });
    expect(briefing.slug).toMatch(/^weekly-climate-roundup-[0-9a-f]{4}$/);
  });

  it("trims the title and stores the intro", async () => {
    const { token } = await registerAndLogin("trim@example.com");

    const response = await post(
      "/api/briefings",
      { title: "  Budget day  ", intro: "  What the numbers hide  " },
      token
    );

    expect(response.body.briefing.title).toBe("Budget day");
    expect(response.body.briefing.intro).toBe("What the numbers hide");
  });

  it("refuses a title outside the limits and an over-long intro", async () => {
    const { token } = await registerAndLogin("limits@example.com");

    const responses = await Promise.all([
      post("/api/briefings", { title: "a".repeat(TITLE_MIN - 1) }, token),
      post("/api/briefings", { title: "a".repeat(TITLE_MAX + 1) }, token),
      post("/api/briefings", { title: "   " }, token),
      post(
        "/api/briefings",
        { title: "Fine", intro: "a".repeat(INTRO_MAX + 1) },
        token
      ),
      post("/api/briefings", {}, token),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }

    const { rows } = await pool.query("SELECT id FROM briefings");
    expect(rows).toHaveLength(0);
  });

  // Ownership and publication are the server's to decide.
  // A body that names either is not an error, it is simply not read.
  it("ignores an author, a status and a date in the body", async () => {
    const author = await registerAndLogin("author@example.com");
    const other = await registerAndLogin("other@example.com");

    const response = await post(
      "/api/briefings",
      {
        title: "Impersonation attempt",
        authorId: other.userId,
        author_id: other.userId,
        status: "published",
        publishedAt: "1999-01-01T00:00:00.000Z",
        published_at: "1999-01-01T00:00:00.000Z",
      },
      author.token
    );

    expect(response.status).toBe(201);
    expect(response.body.briefing.status).toBe("draft");
    expect(response.body.briefing.publishedAt).toBeNull();

    const { rows } = await pool.query<{ author_id: number }>(
      "SELECT author_id FROM briefings"
    );
    expect(rows[0].author_id).toBe(author.userId);
  });

  // The random suffix makes a clash unlikely rather than impossible, and the only way to exercise the retry inside a test's lifetime is to hand it a generator that repeats itself.
  it("retries when a generated address is already taken", async () => {
    const { userId } = await registerAndLogin("clash@example.com");

    const first = await createBriefing(
      userId,
      { title: "Same Title" },
      () => "aaaa"
    );

    const suffixes = ["aaaa", "bbbb"];
    const second = await createBriefing(
      userId,
      { title: "Same Title" },
      () => suffixes.shift()!
    );

    expect(first.slug).toBe("same-title-aaaa");
    expect(second.slug).toBe("same-title-bbbb");
  });
});

describe("editing a briefing", () => {
  // The reason the address is not the title.
  // A published link has to survive its author changing their mind about the wording.
  it("keeps the address when the title changes", async () => {
    const { token } = await registerAndLogin("retitle@example.com");
    const briefing = await startDraft(token, "First thoughts");

    const response = await patch(
      `/api/briefings/${briefing.id}`,
      { title: "Second thoughts" },
      token
    );

    expect(response.status).toBe(200);
    expect(response.body.briefing.title).toBe("Second thoughts");
    expect(response.body.briefing.slug).toBe(briefing.slug);

    const read = await get(`/api/briefings/${briefing.slug}`, token);
    expect(read.status).toBe(200);
  });

  it("clears an intro with an empty string and leaves it alone when absent", async () => {
    const { token } = await registerAndLogin("intro@example.com");
    const response = await post(
      "/api/briefings",
      { title: "With an intro", intro: "Something" },
      token
    );
    const id = response.body.briefing.id;

    const untouched = await patch(
      `/api/briefings/${id}`,
      { title: "Renamed" },
      token
    );
    expect(untouched.body.briefing.intro).toBe("Something");

    const cleared = await patch(`/api/briefings/${id}`, { intro: "" }, token);
    expect(cleared.body.briefing.intro).toBeNull();
  });

  it("refuses an empty patch", async () => {
    const { token } = await registerAndLogin("empty@example.com");
    const briefing = await startDraft(token);

    const response = await patch(`/api/briefings/${briefing.id}`, {}, token);

    expect(response.status).toBe(400);
  });

  it("deletes a briefing and its items with it", async () => {
    const { token } = await registerAndLogin("delete@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    await addStory(token, briefing.id, storyId);

    const response = await del(`/api/briefings/${briefing.id}`, token);

    expect(response.status).toBe(200);
    expect(await itemRows(briefing.id)).toHaveLength(0);

    const { rows } = await pool.query("SELECT id FROM briefings");
    expect(rows).toHaveLength(0);
  });

  it("answers 404 for a briefing that is not there", async () => {
    const { token } = await registerAndLogin("missing@example.com");

    const responses = await Promise.all([
      patch("/api/briefings/9999", { title: "Nothing" }, token),
      del("/api/briefings/9999", token),
      post("/api/briefings/9999/items", { storyId: 1 }, token),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
    }
  });

  it("bounds ids at the largest a Postgres integer holds", async () => {
    const { token } = await registerAndLogin("bounds@example.com");

    const responses = await Promise.all([
      patch(`/api/briefings/${MAX_ID + 1}`, { title: "Too big" }, token),
      del(`/api/briefings/${MAX_ID + 1}`, token),
      patch("/api/briefings/1.5", { title: "Fractional" }, token),
      del("/api/briefings/nonsense", token),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });
});

describe("filing a briefing", () => {
  it("refuses to file a briefing with nothing in it", async () => {
    const { token } = await registerAndLogin("empty-file@example.com");
    const briefing = await startDraft(token);

    const response = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );

    expect(response.status).toBe(409);

    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM briefings"
    );
    expect(rows[0].status).toBe("draft");
  });

  it("sets the date server-side when it is first filed", async () => {
    const { token } = await registerAndLogin("file@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    await addStory(token, briefing.id, storyId);

    const before = Date.now();
    const response = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published", publishedAt: "1999-01-01T00:00:00.000Z" },
      token
    );

    expect(response.status).toBe(200);
    expect(response.body.briefing.status).toBe("published");

    const filedAt = Date.parse(response.body.briefing.publishedAt);
    expect(filedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(filedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // Withdrawing and re-filing must not move a briefing back to the top of the public listing, and must not make a date somebody quoted start disagreeing with the page.
  it("keeps the original date through a withdrawal and a re-file", async () => {
    const { token } = await registerAndLogin("refile@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    await addStory(token, briefing.id, storyId);

    const filed = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );
    const first = filed.body.briefing.publishedAt;

    const withdrawn = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "draft" },
      token
    );
    expect(withdrawn.body.briefing.publishedAt).toBe(first);

    const refiled = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );
    expect(refiled.body.briefing.publishedAt).toBe(first);
  });

  it("rejects a status outside the two", async () => {
    const { token } = await registerAndLogin("status@example.com");
    const briefing = await startDraft(token);

    const response = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "live" },
      token
    );

    expect(response.status).toBe(400);
  });
});

describe("stories in a briefing", () => {
  it("adds each story to the end", async () => {
    const { token } = await registerAndLogin("append@example.com");
    const storyIds = await seedStories(3);
    const briefing = await startDraft(token);

    for (const storyId of storyIds) {
      await addStory(token, briefing.id, storyId);
    }

    expect(await itemRows(briefing.id)).toMatchObject([
      { story_id: storyIds[0], position: 1 },
      { story_id: storyIds[1], position: 2 },
      { story_id: storyIds[2], position: 3 },
    ]);
  });

  // The concurrency guard, made deterministic by holding the lock from the test rather than hoping two requests collide.
  // A timing-based version of this was written first and did not discriminate:
  // removing FOR UPDATE left it green, because the two requests rarely overlapped.
  //
  // What it pins is subtler than the lock.
  // The item count used to be read in the same statement as FOR UPDATE, and under READ COMMITTED a statement that blocks on a row lock sees the fresh version of *that row* while everything else stays on the snapshot from when the statement began.
  // So the count came back stale, and two concurrent deletes on a filed briefing holding two stories would both have believed there were two left.
  it("decides on an item count read after the lock, not before it", async () => {
    const { token } = await registerAndLogin("stale-count@example.com");
    const storyIds = await seedStories(2);
    const briefing = await startDraft(token, "Two stories, filed");
    const items = [
      await addStory(token, briefing.id, storyIds[0]),
      await addStory(token, briefing.id, storyIds[1]),
    ];
    await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );

    const holder = await pool.connect();

    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM briefings WHERE id = $1 FOR UPDATE", [
        briefing.id,
      ]);

      // Blocks on the row this test is holding, inside its own transaction.
      const pending = del(
        `/api/briefings/${briefing.id}/items/${items[0].id}`,
        token
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Take the other story away and let the request through.
      // One story is left and the briefing is filed, so it must now be refused.
      await holder.query("DELETE FROM briefing_items WHERE id = $1", [
        items[1].id,
      ]);
      await holder.query("COMMIT");

      expect((await pending).status).toBe(409);
    } finally {
      holder.release();
    }

    expect(await itemRows(briefing.id)).toHaveLength(1);
  });

  // Every limit is checked on the way in;
  //  only some were checked on the way through.
  // The intro is the quiet one
  //  - it is a TEXT column, so losing the bound would not raise anything, it would just store unbounded prose and serve it on a public read.
  it("refuses over-long prose on the update paths too", async () => {
    const { token } = await registerAndLogin("update-limits@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token, "Original title");
    const item = await addStory(token, briefing.id, storyId, "Original note");

    const responses = await Promise.all([
      patch(
        `/api/briefings/${briefing.id}`,
        { title: "a".repeat(TITLE_MAX + 1) },
        token
      ),
      patch(
        `/api/briefings/${briefing.id}`,
        { intro: "a".repeat(INTRO_MAX + 1) },
        token
      ),
      patch(
        `/api/briefings/${briefing.id}/items/${item.id}`,
        { note: "a".repeat(NOTE_MAX + 1) },
        token
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }

    const { rows } = await pool.query<{ title: string; intro: string | null }>(
      "SELECT title, intro FROM briefings WHERE id = $1",
      [briefing.id]
    );
    expect(rows[0]).toEqual({ title: "Original title", intro: null });
    expect((await itemRows(briefing.id))[0].note).toBe("Original note");
  });

  it("stores the curator's note and lets it be rewritten and cleared", async () => {
    const { token } = await registerAndLogin("note@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);

    const item = await addStory(token, briefing.id, storyId, "Why this one");
    expect(item.note).toBe("Why this one");

    const rewritten = await patch(
      `/api/briefings/${briefing.id}/items/${item.id}`,
      { note: "Actually, this" },
      token
    );
    expect(rewritten.body.item.note).toBe("Actually, this");

    const cleared = await patch(
      `/api/briefings/${briefing.id}/items/${item.id}`,
      { note: "" },
      token
    );
    expect(cleared.body.item.note).toBeNull();
  });

  // An absent note on the one field a patch can change is ambiguous
  //  - "clearit" and "leave it alone" read the same
  //  - so the key is required and clearing is said out loud.
  // Otherwise an empty body quietly erases writing.
  it("refuses a note patch that does not say what the note is", async () => {
    const { token } = await registerAndLogin("no-note-key@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    const item = await addStory(token, briefing.id, storyId, "Keep me");

    const response = await patch(
      `/api/briefings/${briefing.id}/items/${item.id}`,
      {},
      token
    );

    expect(response.status).toBe(400);

    const rows = await itemRows(briefing.id);
    expect(rows[0].note).toBe("Keep me");
  });

  it("refuses a note past the limit", async () => {
    const { token } = await registerAndLogin("long-note@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);

    const response = await post(
      `/api/briefings/${briefing.id}/items`,
      { storyId, note: "a".repeat(NOTE_MAX + 1) },
      token
    );

    expect(response.status).toBe(400);
    expect(await itemRows(briefing.id)).toHaveLength(0);
  });

  it("answers 404 for a story that is not on the wire", async () => {
    const { token } = await registerAndLogin("no-story@example.com");
    const briefing = await startDraft(token);

    const response = await post(
      `/api/briefings/${briefing.id}/items`,
      { storyId: 9999 },
      token
    );

    expect(response.status).toBe(404);
  });

  // The unique constraint decides this, so the failure has to come back as a refusal rather than as an unhandled 23505.
  it("refuses the same story twice in one briefing", async () => {
    const { token } = await registerAndLogin("twice@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    await addStory(token, briefing.id, storyId);

    const response = await post(
      `/api/briefings/${briefing.id}/items`,
      { storyId },
      token
    );

    expect(response.status).toBe(409);
    expect(await itemRows(briefing.id)).toHaveLength(1);
  });

  it("allows the same story in two of your briefings", async () => {
    const { token } = await registerAndLogin("shared@example.com");
    const [storyId] = await seedStories(1);
    const first = await startDraft(token, "First briefing");
    const second = await startDraft(token, "Second briefing");

    await addStory(token, first.id, storyId);
    await addStory(token, second.id, storyId);

    expect(await itemRows(second.id)).toHaveLength(1);
  });

  it("caps a briefing at its limit", async () => {
    const { token } = await registerAndLogin("full@example.com");
    const storyIds = await seedStories(MAX_BRIEFING_ITEMS + 1);
    const briefing = await startDraft(token);

    for (const storyId of storyIds.slice(0, MAX_BRIEFING_ITEMS)) {
      await addStory(token, briefing.id, storyId);
    }

    const response = await post(
      `/api/briefings/${briefing.id}/items`,
      { storyId: storyIds[MAX_BRIEFING_ITEMS] },
      token
    );

    expect(response.status).toBe(409);
    expect(await itemRows(briefing.id)).toHaveLength(MAX_BRIEFING_ITEMS);
  });

  // Positions stay 1..n so that "position 1 is the lede" is true rather than approximately true.
  // Closing the gap moves rows through values their neighbours still hold, which is why it needs the deferred constraint.
  it("closes the gap when a story in the middle is taken out", async () => {
    const { token } = await registerAndLogin("gap@example.com");
    const storyIds = await seedStories(4);
    const briefing = await startDraft(token);
    const items = [];

    for (const storyId of storyIds) {
      items.push(await addStory(token, briefing.id, storyId));
    }

    const response = await del(
      `/api/briefings/${briefing.id}/items/${items[1].id}`,
      token
    );

    expect(response.status).toBe(200);
    expect(await itemRows(briefing.id)).toMatchObject([
      { id: items[0].id, position: 1 },
      { id: items[2].id, position: 2 },
      { id: items[3].id, position: 3 },
    ]);
  });

  // The emptiness guard used to run before anything proved the item existed, so a wrong item id on a one-story filed briefing answered "a filed briefing needs at least one story"
  //  - about an item that was never there.
  it("answers 404, not 409, for an unknown item on a filed briefing", async () => {
    const { token } = await registerAndLogin("wrong-item@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token, "One story, filed");
    await addStory(token, briefing.id, storyId);
    await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );

    const response = await del(
      `/api/briefings/${briefing.id}/items/999999`,
      token
    );

    expect(response.status).toBe(404);
  });

  it("answers 404 for an item that is not there", async () => {
    const { token } = await registerAndLogin("no-item@example.com");
    const briefing = await startDraft(token);

    const responses = await Promise.all([
      patch(`/api/briefings/${briefing.id}/items/9999`, { note: "x" }, token),
      del(`/api/briefings/${briefing.id}/items/9999`, token),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
    }
  });

  // Filing refuses an empty briefing, so emptying a filed one has to be refused too or that rule is one DELETE away from meaning nothing.
  it("refuses to take the last story out of a filed briefing", async () => {
    const { token } = await registerAndLogin("last@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    const item = await addStory(token, briefing.id, storyId);
    await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      token
    );

    const response = await del(
      `/api/briefings/${briefing.id}/items/${item.id}`,
      token
    );

    expect(response.status).toBe(409);
    expect(await itemRows(briefing.id)).toHaveLength(1);
  });

  it("allows the last story out of a draft", async () => {
    const { token } = await registerAndLogin("last-draft@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    const item = await addStory(token, briefing.id, storyId);

    const response = await del(
      `/api/briefings/${briefing.id}/items/${item.id}`,
      token
    );

    expect(response.status).toBe(200);
    expect(await itemRows(briefing.id)).toHaveLength(0);
  });

  // The guarantee the whole concept rests on: a briefing filed today still renders in a year, because the cache physically cannot drop a story it references.
  // Asserted through the API rather than only against hand-written SQL, so it covers the rows this module actually creates.
  it("pins a story in the cache for as long as a briefing references it", async () => {
    const { token } = await registerAndLogin("pinned@example.com");
    const [storyId] = await seedStories(1);
    const briefing = await startDraft(token);
    await addStory(token, briefing.id, storyId);

    await expect(
      pool.query("DELETE FROM stories WHERE id = $1", [storyId])
    ).rejects.toMatchObject({ code: "23503" });
  });
});

describe("reordering a briefing", () => {
  async function briefingOfThree(token: string) {
    const storyIds = await seedStories(3);
    const briefing = await startDraft(token);
    const items = [];

    for (const storyId of storyIds) {
      items.push(await addStory(token, briefing.id, storyId));
    }

    return { briefing, items };
  }

  // A reversal is the case a non-deferred constraint fails on: every row moves through a position another row still holds.
  it("reverses the order without tripping the position constraint", async () => {
    const { token } = await registerAndLogin("reverse@example.com");
    const { briefing, items } = await briefingOfThree(token);

    const response = await put(
      `/api/briefings/${briefing.id}/items`,
      { itemIds: [items[2].id, items[1].id, items[0].id] },
      token
    );

    expect(response.status).toBe(200);
    expect(await itemRows(briefing.id)).toMatchObject([
      { id: items[2].id, position: 1 },
      { id: items[1].id, position: 2 },
      { id: items[0].id, position: 3 },
    ]);
  });

  it("promotes a story to the lede by putting it first", async () => {
    const { token } = await registerAndLogin("lede@example.com");
    const { briefing, items } = await briefingOfThree(token);

    await put(
      `/api/briefings/${briefing.id}/items`,
      { itemIds: [items[1].id, items[0].id, items[2].id] },
      token
    );

    const read = await get(`/api/briefings/${briefing.slug}`, token);

    expect(read.body.briefing.items[0].id).toBe(items[1].id);
    expect(read.body.briefing.items[0].position).toBe(1);
  });

  it("refuses an order that is not exactly the briefing's stories", async () => {
    const { token } = await registerAndLogin("partial@example.com");
    const { briefing, items } = await briefingOfThree(token);
    const other = await briefingOfThree(token);

    const responses = await Promise.all([
      // One missing.
      put(
        `/api/briefings/${briefing.id}/items`,
        { itemIds: [items[0].id, items[1].id] },
        token
      ),
      // One named twice.
      put(
        `/api/briefings/${briefing.id}/items`,
        { itemIds: [items[0].id, items[0].id, items[1].id] },
        token
      ),
      // An item belonging to another briefing.
      put(
        `/api/briefings/${briefing.id}/items`,
        { itemIds: [items[0].id, items[1].id, other.items[0].id] },
        token
      ),
      put(`/api/briefings/${briefing.id}/items`, { itemIds: [] }, token),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 400, 400,
    ]);

    // Nothing moved.
    expect(await itemRows(briefing.id)).toMatchObject([
      { id: items[0].id, position: 1 },
      { id: items[1].id, position: 2 },
      { id: items[2].id, position: 3 },
    ]);
  });
});

describe("one curator cannot reach another's briefing", () => {
  /** A published briefing of B's, with one story in it. */
  async function briefingOfB() {
    const b = await registerAndLogin("owner-b@example.com");
    // Two stories, so that a reorder attempted against this briefing has something to move.
    // With one item, reversing the order is a no-op and the case cannot tell a refusal from a write that did nothing.
    const storyIds = await seedStories(2);
    const briefing = await startDraft(b.token, "B's own work");
    const items = [
      await addStory(b.token, briefing.id, storyIds[0], "B's note"),
      await addStory(b.token, briefing.id, storyIds[1], "B's second note"),
    ];
    const filed = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      b.token
    );

    expect(filed.status).toBe(200);

    return { b, briefing, items, item: items[0], storyIds };
  }

  it("does not let A retitle B's briefing", async () => {
    const a = await registerAndLogin("attacker-a@example.com");
    const { briefing } = await briefingOfB();

    const response = await patch(
      `/api/briefings/${briefing.id}`,
      { title: "Mine now" },
      a.token
    );

    expect(response.status).toBe(404);

    const { rows } = await pool.query<{ title: string }>(
      "SELECT title FROM briefings WHERE id = $1",
      [briefing.id]
    );
    expect(rows[0].title).toBe("B's own work");
  });

  it("does not let A withdraw B's briefing", async () => {
    const a = await registerAndLogin("attacker-withdraw@example.com");
    const { briefing } = await briefingOfB();

    const response = await patch(
      `/api/briefings/${briefing.id}`,
      { status: "draft" },
      a.token
    );

    expect(response.status).toBe(404);

    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM briefings WHERE id = $1",
      [briefing.id]
    );
    expect(rows[0].status).toBe("published");
  });

  it("does not let A delete B's briefing", async () => {
    const a = await registerAndLogin("attacker-delete@example.com");
    const { briefing } = await briefingOfB();

    const response = await del(`/api/briefings/${briefing.id}`, a.token);

    expect(response.status).toBe(404);

    const { rows } = await pool.query(
      "SELECT id FROM briefings WHERE id = $1",
      [briefing.id]
    );
    expect(rows).toHaveLength(1);
  });

  it("does not let A add a story to B's briefing", async () => {
    const a = await registerAndLogin("attacker-add@example.com");
    const { briefing } = await briefingOfB();
    const [extraStory] = await seedStories(1);

    const response = await post(
      `/api/briefings/${briefing.id}/items`,
      { storyId: extraStory },
      a.token
    );

    expect(response.status).toBe(404);
    expect(await itemRows(briefing.id)).toHaveLength(2);
  });

  it("does not let A rewrite or remove B's note", async () => {
    const a = await registerAndLogin("attacker-note@example.com");
    const { briefing, item } = await briefingOfB();

    const responses = await Promise.all([
      patch(
        `/api/briefings/${briefing.id}/items/${item.id}`,
        { note: "Vandalised" },
        a.token
      ),
      del(`/api/briefings/${briefing.id}/items/${item.id}`, a.token),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
    }

    const rows = await itemRows(briefing.id);
    expect(rows[0].note).toBe("B's note");
  });

  it("does not let A reorder B's briefing", async () => {
    const a = await registerAndLogin("attacker-order@example.com");
    const { briefing, items } = await briefingOfB();

    const response = await put(
      `/api/briefings/${briefing.id}/items`,
      { itemIds: [items[1].id, items[0].id] },
      a.token
    );

    expect(response.status).toBe(404);

    // The refusal is only half of it: B's order has to be untouched.
    // This is the one ownership case that used to check the response alone.
    expect((await itemRows(briefing.id)).map((row) => row.id)).toEqual([
      items[0].id,
      items[1].id,
    ]);
  });

  // The path names a briefing you do own, and the body names an item you do not.
  // briefing_id is in the WHERE of every item write for this reason.
  it("does not let an item be edited through another briefing's path", async () => {
    const a = await registerAndLogin("crossed@example.com");
    const mine = await startDraft(a.token, "My briefing");
    const { item } = await briefingOfB();

    const response = await patch(
      `/api/briefings/${mine.id}/items/${item.id}`,
      { note: "Through the side door" },
      a.token
    );

    expect(response.status).toBe(404);

    const { rows } = await pool.query<{ note: string }>(
      "SELECT note FROM briefing_items WHERE id = $1",
      [item.id]
    );
    expect(rows[0].note).toBe("B's note");
  });
});
