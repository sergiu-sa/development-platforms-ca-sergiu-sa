/**
 * The document `/u/:username` serves.
 *
 * Two things carry the weight.
 * **No email may ever reach this page** - it is the most public document the server generates, and the endpoint behind it exists precisely because a byline is a public name and an address is a public thing.
 * And **no draft may reach it either**: the shelf is somebody's published work, and a draft on their own profile is private until they file it.
 *
 * It deliberately does *not* share `/b/:slug`'s byte-identical rule. A briefing's shell hides the difference between a draft and a made-up address because a draft is private content. A username is public the moment it appears on a byline, and the register form already refuses one that is taken, so hiding whether a name exists would buy nothing and cost a designed page.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildCuratorPage } from "../src/modules/briefings/curator-page.shell.js";
import type { BriefingSummary } from "../src/modules/briefings/briefings.service.js";
import { closeDatabase, createSchema, resetDatabase } from "./helpers/db.js";
import { getDocument, registerAndLogin } from "./helpers/request.js";
import { fileBriefing } from "./helpers/seed.js";

const ORIGIN = "https://example.test";

function summary(over: Partial<BriefingSummary> = {}): BriefingSummary {
  return {
    id: 1,
    slug: "the-heat-and-who-pays-7f3a",
    title: "The heat, and who pays for it",
    intro: "Six stories about heat.",
    status: "published",
    publishedAt: "2026-08-01T17:20:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T17:20:00.000Z",
    author: { username: "sergiu" },
    itemCount: 3,
    ledeImageUrl: "https://media.guim.co.uk/abc/1000.jpg",
    ...over,
  };
}

function shelf(over = {}) {
  return {
    username: "sergiu",
    page: 1,
    pageSize: 20,
    total: 1,
    briefings: [summary()],
    ...over,
  };
}

describe("buildCuratorPage", () => {
  it("describes the curator by their stored name", () => {
    const html = buildCuratorPage({
      lookup: { state: "found", shelf: shelf() },
      origin: ORIGIN,
    });

    expect(html).toContain("<title>sergiu on Lede</title>");
    expect(html).toContain('property="og:type" content="profile"');
    expect(html).toContain('property="profile:username" content="sergiu"');
  });

  it("builds og:url from the origin it was handed", () => {
    const html = buildCuratorPage({
      lookup: { state: "found", shelf: shelf() },
      origin: "https://preview.example.test",
    });

    expect(html).toContain('content="https://preview.example.test/u/sergiu"');
  });

  it("takes og:image from the newest briefing's lede", () => {
    const html = buildCuratorPage({
      lookup: { state: "found", shelf: shelf() },
      origin: ORIGIN,
    });

    expect(html).toContain('property="og:image"');
    expect(html).toContain("https://media.guim.co.uk/abc/1000.jpg");
  });

  it("omits og:image rather than pointing at nothing", () => {
    const html = buildCuratorPage({
      lookup: {
        state: "found",
        shelf: shelf({ briefings: [summary({ ledeImageUrl: null })] }),
      },
      origin: ORIGIN,
    });

    expect(html).not.toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("says so, rather than counting to zero, for a curator who has filed nothing", () => {
    const html = buildCuratorPage({
      lookup: { state: "found", shelf: shelf({ total: 0, briefings: [] }) },
      origin: ORIGIN,
    });

    expect(html).toContain("has not filed a briefing yet");
    expect(html).not.toContain("0 briefings");
  });

  it("never echoes a requested name back on a page it cannot describe", () => {
    // The only name available there came out of the URL, and this is the one document on the site built from a path segment.
    const html = buildCuratorPage({
      lookup: { state: "missing" },
      origin: ORIGIN,
    });

    expect(html).toContain("<title>Curator - Lede</title>");
    expect(html).toContain('content="noindex"');
  });

  it("inlines the null it looked up, so the client need not ask again", () => {
    // A resolved "nobody has that name" is an answer. Without it on the page the client cannot tell it from "we could not ask", and spends a second function invocation and a second round trip finding out;
    // on every mistyped or scanned address.
    const html = buildCuratorPage({
      lookup: { state: "missing" },
      origin: ORIGIN,
    });

    expect(html).toContain('id="curator-data">null</script>');
  });

  it("inlines nothing when the lookup never happened, so the client retries", () => {
    // The read threw, or the name could not be a username.
    // Nothing was learned, so the page must not be told there is nobody by that name.
    const html = buildCuratorPage({
      lookup: { state: "unavailable" },
      origin: ORIGIN,
    });

    expect(html).not.toContain('type="application/json"');
  });

  it("escapes a name that would otherwise break out of a meta attribute", () => {
    // Registration cannot produce such a name. The escape is the control, and it must not depend on that staying true.
    const html = buildCuratorPage({
      lookup: { state: "found", shelf: shelf({ username: 'ev"il' }) },
      origin: ORIGIN,
    });

    expect(html).toContain("&quot;il");
    expect(html).not.toContain('content="ev"il');
  });
});

describe("GET /u/:username", () => {
  beforeAll(createSchema);
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("serves the same document at the public path and the API one", async () => {
    // The phase 9 lesson, one prefix along: a vercel.json rewrite never reaches the Hono router, so the pretty path needs a real route or it is a live, correct, unreachable page.
    const { token, username } = await registerAndLogin("shelfa@example.com");
    await fileBriefing(token, "Reachable at its own address");

    const pretty = await getDocument(`/u/${username}`);
    const api = await getDocument(`/api/curators/${username}/page`);

    expect(pretty.status).toBe(200);
    expect(pretty.contentType).toContain("text/html");
    expect(pretty.html).toContain(username);
    // One handler, so the two paths cannot drift into different documents.
    expect(pretty.html).toBe(api.html);
  });

  it("never puts an email in the document", async () => {
    // The oldest standing rule in this codebase, on the page most likely to be scraped.
    const email = "shelfb@example.com";
    const { token, username } = await registerAndLogin(email);
    await fileBriefing(token, "Filed and public");

    const page = await getDocument(`/u/${username}`);

    expect(page.html).toContain(username);
    expect(page.html).not.toContain(email);
    expect(page.html).not.toContain("@example.com");
  });

  it("never carries a draft, not even the curator's own", async () => {
    const { token, username } = await registerAndLogin("shelfc@example.com");
    await fileBriefing(token, "Filed and visible");
    await fileBriefing(token, "Still a secret draft", { file: false });

    const page = await getDocument(`/u/${username}`);

    expect(page.html).toContain("Filed and visible");
    expect(page.html).not.toContain("Still a secret draft");
  });

  it("stays anonymous even when a valid token is offered", async () => {
    // A browser cannot send Authorization on a document request, so a route that varied on one would behave differently from the thing it serves.
    const { token, username } = await registerAndLogin("shelfd@example.com");
    await fileBriefing(token, "A draft of mine", { file: false });

    const withToken = await getDocument(`/u/${username}`, {
      Authorization: `Bearer ${token}`,
    });
    const without = await getDocument(`/u/${username}`);

    expect(withToken.html).toBe(without.html);
    expect(withToken.html).not.toContain("A draft of mine");
  });

  it("gives a curator with nothing filed a page of their own", async () => {
    // Deliberately not byte-identical to an unknown name. The reasoning is in the shell's header.
    const { username } = await registerAndLogin("shelfe@example.com");

    const known = await getDocument(`/u/${username}`);
    const unknown = await getDocument("/u/nobodyhasthisname");

    expect(known.status).toBe(200);
    expect(known.html).toContain(username);
    expect(known.html).toContain("has not filed a briefing yet");
    expect(known.html).not.toBe(unknown.html);
  });

  it("answers a name nobody has with a document rather than an error", async () => {
    const missing = await getDocument("/u/nobodyhasthisname");

    expect(missing.status).toBe(200);
    expect(missing.contentType).toContain("text/html");
    expect(missing.html).not.toContain("nobodyhasthisname");
  });

  it("answers a name that could not be a username with a document too", async () => {
    // It used to be a JSON 400 from zValidator, which is not what somebody who mistyped an address should be handed.
    const bad = await getDocument("/u/a");
    const worse = await getDocument("/u/not%20a%20name");

    expect(bad.status).toBe(200);
    expect(bad.contentType).toContain("text/html");
    expect(worse.status).toBe(200);
    // Both are the same undescribable shell, so neither says which kind of nothing it found.
    expect(bad.html).toBe(worse.html);
  });

  it("finds a curator whose name was typed in another case", async () => {
    // Usernames are unique case-insensitively, so /u/SERGIU is the same page - and it must advertise the stored spelling as canonical, not the typed one.
    const { token, username } = await registerAndLogin("shelff@example.com");
    await fileBriefing(token, "Case does not matter");

    const shouted = await getDocument(`/u/${username.toUpperCase()}`);

    expect(shouted.status).toBe(200);
    expect(shouted.html).toContain("Case does not matter");
    expect(shouted.html).toContain(`content="http://localhost/u/${username}"`);
    expect(shouted.html).not.toContain(username.toUpperCase());
  });

  it("inlines the shelf so the page does not ask for it twice", async () => {
    const { token, username } = await registerAndLogin("shelfg@example.com");
    await fileBriefing(token, "Inlined");

    const page = await getDocument(`/u/${username}`);
    const payload = /id="curator-data">([\s\S]*?)<\/script>/.exec(page.html);

    expect(payload).not.toBeNull();
    const parsed = JSON.parse(payload![1]);
    expect(parsed.username).toBe(username);
    expect(parsed.briefings[0].title).toBe("Inlined");
    expect(parsed.page).toBe(1);
  });

  it("does not claim https when it was reached over http", async () => {
    const { token, username } = await registerAndLogin("shelfh@example.com");
    await fileBriefing(token, "Plain http");

    const page = await getDocument(`/u/${username}`, {
      host: "localhost:3100",
    });

    expect(page.html).toContain(
      `content="http://localhost:3100/u/${username}"`
    );
    expect(page.html).not.toContain("https://localhost");
  });

  it("describes itself with the host it was reached on", async () => {
    const { token, username } = await registerAndLogin("shelfi@example.com");
    await fileBriefing(token, "Somewhere else");

    const page = await getDocument(`/u/${username}`, {
      "x-forwarded-host": "preview.example.test",
      "x-forwarded-proto": "https",
    });

    expect(page.html).toContain(
      `content="https://preview.example.test/u/${username}"`
    );
  });

  it("carries the page it was asked for", async () => {
    const { token, username } = await registerAndLogin("shelfj@example.com");
    await fileBriefing(token, "Only one");

    const page = await getDocument(`/u/${username}?page=2`);
    const payload = /id="curator-data">([\s\S]*?)<\/script>/.exec(page.html);

    expect(JSON.parse(payload![1]).page).toBe(2);
    // The true total, so the pager can say "of 1" rather than inventing a page.
    expect(JSON.parse(payload![1]).total).toBe(1);
  });

  it("still serves the JSON listing beside it", async () => {
    // `/:username/page` is two segments and must not shadow `/:username`, which the client falls back to when nothing was inlined.
    const { token, username } = await registerAndLogin("shelfk@example.com");
    await fileBriefing(token, "Both routes");

    const json = await getDocument(`/api/curators/${username}`);

    expect(json.status).toBe(200);
    expect(json.contentType).toContain("application/json");
  });
});
