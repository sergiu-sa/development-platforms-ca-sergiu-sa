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
import { fileBriefing } from "./helpers/seed.js";
import { get, patch, post, registerAndLogin } from "./helpers/request.js";
import {
  BRIEFINGS_PAGE_SIZE,
  MAX_BRIEFINGS_PAGE,
} from "../src/modules/briefings/briefings.schema.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

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

  it("carries the lede's photograph, so a card can stand for the briefing", async () => {
    const { token } = await registerAndLogin("list-image@example.com");
    await fileBriefing(token, "With a picture");

    const response = await get("/api/briefings");

    // The wide image, which is what the client would pick for itself.
    expect(response.body.briefings[0].ledeImageUrl).toMatch(/1000\.jpg$/);
  });

  it("reports no picture for a briefing holding no stories", async () => {
    // Only a draft can be empty, and drafts are absent from this listing, so the null branch is reached through the author's own shelf instead.
    const { token } = await registerAndLogin("list-empty@example.com");
    const created = await post(
      "/api/briefings",
      { title: "Nothing in it" },
      token
    );

    expect(created.body.briefing.ledeImageUrl).toBeNull();
  });

  it("leaves a draft out, including for its own author", async () => {
    const { token } = await registerAndLogin("draft-list@example.com");
    const filed = await fileBriefing(token, "A filed one");
    await fileBriefing(token, "A draft", { file: false });

    const anonymous = await get("/api/briefings");
    const asAuthor = await get("/api/briefings", token);

    // The filed one is the control: without it, both assertions below would hold for a listing that returned nothing at all.
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

// The one read that returns a draft as a matter of course, and the reason the builder can be left and come back to.
// Everything else here is about keeping drafts hidden;
// this is about their author being able to find them.
describe("the briefings on your own desk", () => {
  it("carries your drafts alongside your filed work", async () => {
    const { token } = await registerAndLogin("mine@example.com");
    const filed = await fileBriefing(token, "Filed work");
    const draft = await fileBriefing(token, "Unfinished work", { file: false });

    const response = await get("/api/desk/briefings", token);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(
      response.body.briefings.map((b: { slug: string }) => b.slug).sort()
    ).toEqual([draft.slug, filed.slug].sort());
  });

  // The public listings sort by published_at, which a draft has not got.
  // Sorting this one the same way would bunch every unfinished briefing at one end, which is the opposite of what a list of work in progress is for.
  it("puts the most recently worked on first, not the most recently filed", async () => {
    const { token } = await registerAndLogin("recent@example.com");
    const older = await fileBriefing(token, "Started first");
    await fileBriefing(token, "Started second");

    const touched = await patch(
      `/api/briefings/${older.id}`,
      { title: "Started first, edited last" },
      token
    );
    expect(touched.status).toBe(200);

    const response = await get("/api/desk/briefings", token);

    expect(response.body.briefings[0].slug).toBe(older.slug);
  });

  it("never carries another curator's work, filed or draft", async () => {
    const one = await registerAndLogin("desk-one@example.com");
    const two = await registerAndLogin("desk-two@example.com");
    await fileBriefing(one.token, "By one");
    await fileBriefing(one.token, "By one, unfinished", { file: false });
    const mine = await fileBriefing(two.token, "By two", { file: false });

    const response = await get("/api/desk/briefings", two.token);

    expect(response.body.total).toBe(1);
    expect(response.body.briefings[0].slug).toBe(mine.slug);
  });

  it("refuses a request carrying no token", async () => {
    const { token } = await registerAndLogin("guarded@example.com");
    await fileBriefing(token, "Private work", { file: false });

    const response = await get("/api/desk/briefings");

    expect(response.status).toBe(401);
    expect(response.body.briefings).toBeUndefined();
  });

  // The reason this endpoint is not GET /api/briefings/mine.
  // The public router is mounted first and its "/:slug" matches any single segment, so that address is read as a request for a briefing whose slug is "mine" and answered 404.
  // It fails closed, and this pins it so nobody moves the route there later and finds out the hard way.
  it("is not reachable at /api/briefings/mine, which is a slug lookup", async () => {
    const { token } = await registerAndLogin("shadowed@example.com");
    await fileBriefing(token, "Private work", { file: false });

    const response = await get("/api/briefings/mine", token);

    expect(response.status).toBe(404);
    expect(response.body.briefings).toBeUndefined();
  });

  it("reports the true total on a page past the end", async () => {
    const { token } = await registerAndLogin("paged@example.com");
    await fileBriefing(token, "Only one", { file: false });

    const response = await get("/api/desk/briefings?page=2", token);

    expect(response.status).toBe(200);
    expect(response.body.briefings).toEqual([]);
    expect(response.body.total).toBe(1);
  });

  it("answers an empty list rather than an error for a curator who has written nothing", async () => {
    const { token } = await registerAndLogin("blank@example.com");

    const response = await get("/api/desk/briefings", token);

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
