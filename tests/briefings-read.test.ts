/**
 * Reading briefings, and the one rule that matters most here: a draft belongs to its author and does not exist for anybody else.
 *
 * The cases below check that from every direction it can be asked
 *  - the public listing, the address itself, a curator's shelf, signed in as somebody else, and signed in as nobody at all
 *  - because "invisible" is only true if it is true from all of them.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { pool } from "../src/db/connection.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { seedStories } from "./helpers/seed.js";
import { get, post, patch, registerAndLogin } from "./helpers/request.js";
import {
  BRIEFINGS_PAGE_SIZE,
  MAX_BRIEFINGS_PAGE,
} from "../src/modules/briefings/briefings.schema.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

/** A briefing with one story, filed unless `file` says otherwise. */
async function fileBriefing(
  token: string,
  title: string,
  options: { file?: boolean; note?: string } = {}
) {
  const created = await post("/api/briefings", { title }, token);
  expect(created.status).toBe(201);
  const briefing = created.body.briefing;
  const [storyId] = await seedStories(1);

  // Checked rather than assumed. Unchecked, a regression in the write path surfaces as an undefined slug three tests later, naming the wrong thing.
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

describe("the public listing", () => {
  it("carries filed briefings, newest first", async () => {
    const { token, username } = await registerAndLogin("list@example.com");
    await fileBriefing(token, "First one");
    const second = await fileBriefing(token, "Second one");

    const response = await get("/api/briefings");

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.pageSize).toBe(BRIEFINGS_PAGE_SIZE);
    expect(response.body.briefings[0].slug).toBe(second.slug);
    expect(response.body.briefings[0].author).toEqual({ username });
    expect(response.body.briefings[0].itemCount).toBe(1);
  });

  it("leaves a draft out, including for its own author", async () => {
    const { token } = await registerAndLogin("draft-list@example.com");
    const filed = await fileBriefing(token, "A filed one");
    await fileBriefing(token, "A draft", { file: false });

    const anonymous = await get("/api/briefings");
    const asAuthor = await get("/api/briefings", token);

    // The filed one is the control: without it, both assertions below would
    // hold for a listing that returned nothing at all.
    expect(
      anonymous.body.briefings.map((b: { slug: string }) => b.slug)
    ).toEqual([filed.slug]);
    // The listing is the public front page, not a workspace.
    // A curator's own drafts belong on a page that is about them, which is phase 10's problem.
    expect(
      asAuthor.body.briefings.map((briefing: { slug: string }) => briefing.slug)
    ).toEqual([filed.slug]);
  });

  it("leaves a withdrawn briefing out again", async () => {
    const { token } = await registerAndLogin("withdrawn@example.com");
    const briefing = await fileBriefing(token, "Filed then withdrawn");

    await patch(`/api/briefings/${briefing.id}`, { status: "draft" }, token);

    const response = await get("/api/briefings");
    expect(response.body.briefings).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  // What a curator actually cares about when they take something down.
  // The listing is secondary; the link people already have is the thing.
  it("stops serving a withdrawn briefing at its own address", async () => {
    const { token } = await registerAndLogin("withdrawn-slug@example.com");
    const briefing = await fileBriefing(token, "Up then down");

    expect((await get(`/api/briefings/${briefing.slug}`)).status).toBe(200);

    await patch(`/api/briefings/${briefing.id}`, { status: "draft" }, token);

    expect((await get(`/api/briefings/${briefing.slug}`)).status).toBe(404);
    // Still its author's, though.
    expect((await get(`/api/briefings/${briefing.slug}`, token)).status).toBe(
      200
    );
  });

  // 20 per page, so two briefings can never tell (page - 1) * size from page * size - both give an empty page 2. This one can.
  it("slices the listing at the page boundary", async () => {
    const { userId } = await registerAndLogin("paging-boundary@example.com");
    const total = BRIEFINGS_PAGE_SIZE + 1;

    await pool.query(
      `INSERT INTO briefings (author_id, title, slug, status, published_at)
       SELECT $1, 'Briefing ' || n, 'briefing-' || n || '-aaaa', 'published',
              now() - make_interval(mins => n)
         FROM generate_series(1, $2) AS n`,
      [userId, total]
    );

    const first = await get("/api/briefings");
    const second = await get("/api/briefings?page=2");

    expect(first.body.briefings).toHaveLength(BRIEFINGS_PAGE_SIZE);
    expect(second.body.briefings).toHaveLength(1);
    expect(first.body.total).toBe(total);
    expect(second.body.total).toBe(total);
    // Newest first, so the last page holds the oldest. An off-by-one in the OFFSET puts the wrong briefing here.
    expect(second.body.briefings[0].title).toBe(`Briefing ${total}`);
  });

  it("pages, and reports the real total past the end", async () => {
    const { token } = await registerAndLogin("paging@example.com");
    await fileBriefing(token, "One");
    await fileBriefing(token, "Two");

    const beyond = await get("/api/briefings?page=2");

    expect(beyond.status).toBe(200);
    expect(beyond.body.briefings).toEqual([]);
    // count(*) OVER () comes back with the rows, so an empty page has none of it.
    // Reporting zero here would tell a reader there is nothing at all.
    expect(beyond.body.total).toBe(2);
  });

  it("bounds the page number", async () => {
    const responses = await Promise.all([
      get("/api/briefings?page=0"),
      get("/api/briefings?page=1.5"),
      get("/api/briefings?page=nonsense"),
      get(`/api/briefings?page=${MAX_BRIEFINGS_PAGE + 1}`),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });
});

describe("reading one briefing", () => {
  it("carries the whole story for each item, in the curator's order", async () => {
    const { token } = await registerAndLogin("reading@example.com");
    const briefing = await fileBriefing(token, "The reading view", {
      note: "Read this one first",
    });

    const response = await get(`/api/briefings/${briefing.slug}`);

    expect(response.status).toBe(200);

    const [item] = response.body.briefing.items;
    expect(item.position).toBe(1);
    expect(item.note).toBe("Read this one first");
    expect(item.storyId).toBe(briefing.storyId);
    // The same shape the wire serves, so the reading view can draw the card grammar without a second story format existing.
    expect(item.story).toMatchObject({
      id: briefing.storyId,
      title: expect.any(String),
      standfirst: "A standfirst",
      byline: "A Reporter",
      pillar: "News",
      tone: "news",
      wordCount: 460,
      imageUrl: expect.stringContaining("1000.jpg"),
      imageAlt: "A photograph",
    });
    expect(item.story.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("answers 404 for an address nobody has", async () => {
    const response = await get("/api/briefings/nothing-here-0000");

    expect(response.status).toBe(404);
  });

  it("refuses an address that could not be one", async () => {
    const response = await get("/api/briefings/NOT%20A%20SLUG");

    expect(response.status).toBe(400);
  });
});

describe("a draft is invisible to everyone but its author", () => {
  async function draftOfB() {
    const b = await registerAndLogin("drafter@example.com");
    const briefing = await fileBriefing(b.token, "Still working on it", {
      file: false,
    });

    return { b, briefing };
  }

  it("is 404 to an anonymous reader", async () => {
    const { briefing } = await draftOfB();

    const response = await get(`/api/briefings/${briefing.slug}`);

    expect(response.status).toBe(404);
  });

  // 404 rather than 403 on purpose: 403 would confirm that a briefing exists at that address and that it is somebody else's.
  it("is 404 to another signed-in curator", async () => {
    const a = await registerAndLogin("stranger@example.com");
    const { briefing } = await draftOfB();

    const response = await get(`/api/briefings/${briefing.slug}`, a.token);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("That briefing does not exist");
  });

  it("is readable by its own author, at the address it will keep", async () => {
    const { b, briefing } = await draftOfB();

    const response = await get(`/api/briefings/${briefing.slug}`, b.token);

    expect(response.status).toBe(200);
    expect(response.body.briefing.status).toBe("draft");
    expect(response.body.briefing.items).toHaveLength(1);
  });

  it("becomes visible to everyone the moment it is filed", async () => {
    const { b, briefing } = await draftOfB();

    await patch(
      `/api/briefings/${briefing.id}`,
      { status: "published" },
      b.token
    );

    const response = await get(`/api/briefings/${briefing.slug}`);
    expect(response.status).toBe(200);
  });
});

describe("a curator's shelf", () => {
  it("carries their filed briefings and no drafts", async () => {
    const { token, username } = await registerAndLogin("shelf@example.com");
    const filed = await fileBriefing(token, "Filed work");
    await fileBriefing(token, "Unfinished work", { file: false });

    const response = await get(`/api/curators/${username}`);

    expect(response.status).toBe(200);
    expect(response.body.curator).toEqual({ username });
    expect(response.body.total).toBe(1);
    expect(response.body.briefings[0].slug).toBe(filed.slug);
  });

  it("does not carry another curator's work", async () => {
    const one = await registerAndLogin("curator-one@example.com");
    const two = await registerAndLogin("curator-two@example.com");
    await fileBriefing(one.token, "By one");
    await fileBriefing(two.token, "By two");

    const response = await get(`/api/curators/${one.username}`);

    expect(response.body.total).toBe(1);
    expect(response.body.briefings[0].title).toBe("By one");
  });

  // Usernames are unique case-insensitively and printed as they were registered, so a link written in the wrong case has to resolve.
  it("finds a curator whatever case the name is written in", async () => {
    const { token, username } = await registerAndLogin(
      "Casing@example.com",
      "MixedCase"
    );
    await fileBriefing(token, "Cased");

    const response = await get(`/api/curators/${username.toLowerCase()}`);

    expect(response.status).toBe(200);
    expect(response.body.curator.username).toBe("MixedCase");
  });

  it("answers 404 for a name nobody has", async () => {
    const response = await get("/api/curators/nobody");

    expect(response.status).toBe(404);
  });

  it("answers an empty shelf rather than 404 for a curator who has filed nothing", async () => {
    const { username } = await registerAndLogin("quiet@example.com");

    const response = await get(`/api/curators/${username}`);

    expect(response.status).toBe(200);
    expect(response.body.briefings).toEqual([]);
    expect(response.body.total).toBe(0);
  });
});

// The oldest standing rule in this codebase, and these are the endpoints it was written for:
// anyone at all can call them, so an email on one of them publishes the userbase.
describe("public reads never carry an email", () => {
  it("keeps every address off the listing, the reading view and the shelf", async () => {
    const email = "private@example.com";
    const { token, username } = await registerAndLogin(email);
    const briefing = await fileBriefing(token, "Public work");

    const responses = await Promise.all([
      get("/api/briefings"),
      get(`/api/briefings/${briefing.slug}`),
      get(`/api/curators/${username}`),
      // Signed in as the author too:
      // the serializer is shared, so a leak would be identical, but this is the request that actually has a user object in scope to leak from.
      get(`/api/briefings/${briefing.slug}`, token),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);

      expect(body).not.toContain(email);
      expect(body).not.toContain("password");
      expect(body).toContain(username);
    }
  });
});
