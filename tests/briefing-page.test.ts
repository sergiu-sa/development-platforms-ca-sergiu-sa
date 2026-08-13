/**
 * The document `/b/:slug` serves.
 *
 * Two things carry the weight here.
 * A draft and an address that never existed must produce byte-identical shells, because a document request cannot be authenticated and the page must not become the thing that tells them apart.
 * And both escapers must hold against a curator who writes markup into a title or a note, since every field on this page is somebody's free text.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildBriefingPage } from "../src/modules/briefings/briefing-page.shell.js";
import type { Briefing } from "../src/modules/briefings/briefings.service.js";
import type { WireStoryRow } from "../src/modules/wire/wire.service.js";
import { closeDatabase, createSchema, resetDatabase } from "./helpers/db.js";
import { getDocument, registerAndLogin } from "./helpers/request.js";
import { fileBriefing } from "./helpers/seed.js";

const ORIGIN = "https://example.test";

function story(over: Partial<WireStoryRow> = {}): WireStoryRow {
  return {
    id: 100,
    title: "Spanish PM calls for urgent EU meeting",
    summary: null,
    standfirst: null,
    byline: "Sam Jones in Madrid",
    url: "https://www.theguardian.com/world/2026/aug/01/example",
    section: "World news",
    pillar: "News",
    tone: "news" as const,
    wordCount: 1027,
    starRating: null,
    thumbnailUrl: "https://media.guim.co.uk/abc/500.jpg",
    imageUrl: "https://media.guim.co.uk/abc/1000.jpg",
    imageAlt: "Police officers at the border",
    imageCredit: "Photograph: Jon Nazca/Reuters",
    publishedAt: "2026-08-01T12:35:04.000Z",
    ...over,
  };
}

function fixture(over: Partial<Briefing> = {}): Briefing {
  return {
    id: 1,
    slug: "the-heat-and-who-pays-7f3a",
    title: "The heat, and who pays for it",
    intro: "Six stories about heat, and about who ends up paying for it.",
    status: "published",
    publishedAt: "2026-08-01T17:20:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T17:20:00.000Z",
    author: { username: "sergiu" },
    itemCount: 1,
    items: [
      {
        id: 10,
        storyId: 100,
        note: "The part that will still matter in a month.",
        position: 1,
        story: story(),
      },
    ],
    ledeImageUrl: "https://media.guim.co.uk/abc/1000.jpg",
    ...over,
  };
}

describe("buildBriefingPage", () => {
  it("gives a draft and an unknown address byte-identical shells", () => {
    // The whole privacy property of this route. A document request carries no Authorization header, so the server cannot know whether the reader is the author - and must therefore say nothing either way.
    const draft = buildBriefingPage({
      briefing: null,
      origin: ORIGIN,
      slug: "somebodys-secret-draft-7f3a",
    });
    const missing = buildBriefingPage({
      briefing: null,
      origin: ORIGIN,
      slug: "never-existed-0000",
    });

    expect(draft).toBe(missing);
  });

  it("does not leak the slug into the shell it cannot describe", () => {
    const html = buildBriefingPage({
      briefing: null,
      origin: ORIGIN,
      slug: "somebodys-secret-draft-7f3a",
    });

    expect(html).not.toContain("somebodys-secret-draft");
  });

  it("carries the briefing's own title and intro when it may be described", () => {
    const html = buildBriefingPage({
      briefing: fixture(),
      origin: ORIGIN,
      slug: "the-heat-and-who-pays-7f3a",
    });

    expect(html).toContain("The heat, and who pays for it");
    expect(html).toContain('property="og:title"');
    expect(html).toContain("Six stories about heat");
  });

  it("takes og:image from the lede, which is the story position 1", () => {
    const html = buildBriefingPage({
      briefing: fixture(),
      origin: ORIGIN,
      slug: "s",
    });

    expect(html).toContain('property="og:image"');
    expect(html).toContain("https://media.guim.co.uk/abc/1000.jpg");
  });

  it("omits og:image rather than pointing at nothing when the lede has no picture", () => {
    const briefing = fixture();
    briefing.items[0].story = story({ imageUrl: null, thumbnailUrl: null });
    briefing.ledeImageUrl = null;

    const html = buildBriefingPage({ briefing, origin: ORIGIN, slug: "s" });

    expect(html).not.toContain('property="og:image"');
  });

  it("builds og:url from the origin it was handed", () => {
    const html = buildBriefingPage({
      briefing: fixture(),
      origin: "https://preview.example.test",
      slug: "the-heat-and-who-pays-7f3a",
    });

    expect(html).toContain(
      'content="https://preview.example.test/b/the-heat-and-who-pays-7f3a"'
    );
  });

  it("escapes a title that would otherwise break out of a meta attribute", () => {
    const html = buildBriefingPage({
      briefing: fixture({ title: 'He said "no" & meant it' }),
      origin: ORIGIN,
      slug: "s",
    });

    expect(html).toContain("&quot;no&quot;");
    expect(html).not.toContain('content="He said "no"');
  });

  it("never lets an inlined note close the script tag it sits in", () => {
    const briefing = fixture();
    briefing.items[0].note = "</script><script>alert(1)</script>";

    const html = buildBriefingPage({ briefing, origin: ORIGIN, slug: "s" });

    // One data block and one module script for the page bundle, and nothing a note managed to open.
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).not.toContain("alert(1)</script>");
  });

  it("inlines a briefing the client can parse straight back", () => {
    const briefing = fixture({ title: 'Quotes "and" <angles>' });
    const html = buildBriefingPage({ briefing, origin: ORIGIN, slug: "s" });

    const payload =
      /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    expect(payload).not.toBeNull();
    expect(JSON.parse(payload![1]).title).toBe('Quotes "and" <angles>');
  });

  it("inlines nothing when there is no briefing to inline", () => {
    const html = buildBriefingPage({
      briefing: null,
      origin: ORIGIN,
      slug: "s",
    });

    expect(html).not.toContain('type="application/json"');
  });

  it("points at the two assets whose names the build pins", () => {
    const html = buildBriefingPage({
      briefing: fixture(),
      origin: ORIGIN,
      slug: "s",
    });

    expect(html).toContain("/assets/lede.css");
    expect(html).toContain("/assets/briefing.js");
  });
});

describe("GET /api/briefings/:slug/page", () => {
  beforeAll(createSchema);
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("serves the same document at the public /b/:slug path", async () => {
    // The path a reader's browser actually asks for, and the one that was missing.
    // hono/vercel rebuilds the request from the ORIGINAL url, so vercel.json's rewrite never reaches the router: on a real deployment the function ran, saw /b/:slug, and answered its own 404 while every local check passed against the API path below.
    const { token } = await registerAndLogin("page-public@example.com");
    const briefing = await fileBriefing(token, "Reachable at its own address");

    const pretty = await getDocument(`/b/${briefing.slug}`);
    const api = await getDocument(`/api/briefings/${briefing.slug}/page`);

    expect(pretty.status).toBe(200);
    expect(pretty.contentType).toContain("text/html");
    expect(pretty.html).toContain("Reachable at its own address");
    // One handler, so the two paths cannot drift into different documents.
    expect(pretty.html).toBe(api.html);
  });

  it("answers the public path for an unknown slug too, with the same shell", async () => {
    const missing = await getDocument("/b/never-existed-0000");

    expect(missing.status).toBe(200);
    expect(missing.contentType).toContain("text/html");
  });

  it("serves a filed briefing as a document carrying its own meta", async () => {
    const { token } = await registerAndLogin("page-served@example.com");
    const briefing = await fileBriefing(token, "The heat, and who pays for it");

    const page = await getDocument(`/api/briefings/${briefing.slug}/page`);

    expect(page.status).toBe(200);
    expect(page.contentType).toContain("text/html");
    expect(page.html).toContain("The heat, and who pays for it");
    expect(page.html).toContain('property="og:title"');
    expect(page.html).toContain('id="briefing-data"');
  });

  it("answers a draft and an address that never existed identically", async () => {
    // The route reads as an anonymous viewer whatever the request carries, so this holds for the author too;
    // a document request has no token on it.
    const { token } = await registerAndLogin("page-draft@example.com");
    const draft = await fileBriefing(token, "Not filed yet", { file: false });

    const asDraft = await getDocument(`/api/briefings/${draft.slug}/page`);
    const asMissing = await getDocument(
      "/api/briefings/never-existed-0000/page"
    );

    expect(asDraft.status).toBe(200);
    expect(asDraft.html).toBe(asMissing.html);
    expect(asDraft.html).not.toContain("Not filed yet");
  });

  it("stays anonymous even when a valid token is offered", async () => {
    // A browser cannot send Authorization on a document request, so a route that varied on one would behave differently from the thing it serves.
    const { token } = await registerAndLogin("page-token@example.com");
    const draft = await fileBriefing(token, "A private draft", { file: false });

    const withToken = await getDocument(`/api/briefings/${draft.slug}/page`, {
      Authorization: `Bearer ${token}`,
    });
    const without = await getDocument(`/api/briefings/${draft.slug}/page`);

    expect(withToken.html).toBe(without.html);
  });

  it("does not claim https when it was reached over http", async () => {
    // Defaulting the scheme to https made a local server advertise https://localhost, and a canonical URL nothing can fetch is worse than none.
    // Vercel always sends the forwarded header, so this only bites here.
    const { token } = await registerAndLogin("page-scheme@example.com");
    const briefing = await fileBriefing(token, "Plain http");

    const page = await getDocument(`/api/briefings/${briefing.slug}/page`, {
      host: "localhost:3100",
    });

    expect(page.html).toContain('content="http://localhost:3100/b/');
    expect(page.html).not.toContain("https://localhost");
  });

  it("describes itself with the host it was reached on", async () => {
    const { token } = await registerAndLogin("page-origin@example.com");
    const briefing = await fileBriefing(token, "Somewhere else");

    const page = await getDocument(`/api/briefings/${briefing.slug}/page`, {
      "x-forwarded-host": "preview.example.test",
      "x-forwarded-proto": "https",
    });

    expect(page.html).toContain(
      `content="https://preview.example.test/b/${briefing.slug}"`
    );
  });

  it("inlines the briefing so the page does not ask for it twice", async () => {
    const { token } = await registerAndLogin("page-inlined@example.com");
    const briefing = await fileBriefing(token, "Inlined", {
      note: "The note the client should already have.",
    });

    const page = await getDocument(`/api/briefings/${briefing.slug}/page`);
    const payload = /id="briefing-data">([\s\S]*?)<\/script>/.exec(page.html);

    expect(payload).not.toBeNull();
    const parsed = JSON.parse(payload![1]);
    expect(parsed.slug).toBe(briefing.slug);
    expect(parsed.items[0].note).toBe(
      "The note the client should already have."
    );
  });

  it("still serves the JSON route beside it", async () => {
    // `/:slug/page` is two segments and must not shadow `/:slug`, which the reading view falls back to when nothing was inlined.
    const { token } = await registerAndLogin("page-beside@example.com");
    const briefing = await fileBriefing(token, "Both routes");

    const json = await getDocument(`/api/briefings/${briefing.slug}`);

    expect(json.status).toBe(200);
    expect(json.contentType).toContain("application/json");
  });
});
