/**
 * Guardian client tests.
 *
 * Every case passes an explicit fetchImpl, so nothing here can reach the live
 * API even by accident. The Guardian allows 500 requests a day and CI runs on
 * every push.
 */

import { describe, it, expect } from "vitest";
import { fetchGuardianStories } from "../src/modules/wire/wire.guardian.js";

function guardianResponse(
  results: unknown[],
  init: { remaining?: string } = {}
): Response {
  return new Response(JSON.stringify({ response: { status: "ok", results } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.remaining
        ? { "x-ratelimit-remaining-day": init.remaining }
        : {}),
    },
  });
}

const sampleResult = {
  id: "sport/2026/jul/28/geneva-world-chess-championship",
  webTitle: "Geneva lands world chess title match",
  webUrl: "https://www.theguardian.com/sport/2026/jul/28/geneva",
  sectionName: "Sport",
  webPublicationDate: "2026-07-28T17:57:32Z",
  fields: {
    trailText: "Geneva will host the championship",
    thumbnail: "https://media.guim.co.uk/abc/500.jpg",
  },
};

describe("fetchGuardianStories", () => {
  it("maps a Guardian result onto the stories shape", async () => {
    const { stories } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () => guardianResponse([sampleResult]),
    });

    expect(stories).toEqual([
      {
        externalId: "sport/2026/jul/28/geneva-world-chess-championship",
        title: "Geneva lands world chess title match",
        summary: "Geneva will host the championship",
        url: "https://www.theguardian.com/sport/2026/jul/28/geneva",
        section: "Sport",
        thumbnailUrl: "https://media.guim.co.uk/abc/500.jpg",
        publishedAt: "2026-07-28T17:57:32Z",
      },
    ]);
  });

  it("sends the key and the fields the stories table needs", async () => {
    let requested = "";

    await fetchGuardianStories({
      apiKey: "secret-key",
      fetchImpl: async (input) => {
        requested = String(input);
        return guardianResponse([]);
      },
    });

    const url = new URL(requested);
    expect(url.origin + url.pathname).toBe(
      "https://content.guardianapis.com/search"
    );
    expect(url.searchParams.get("api-key")).toBe("secret-key");
    expect(url.searchParams.get("show-fields")).toBe("thumbnail,trailText");
    expect(url.searchParams.get("order-by")).toBe("newest");
  });

  // The frontend escapes everything it renders, so markup left in place would
  // put a literal "<strong>" on screen rather than bold text.
  it("strips HTML and decodes entities out of the summary", async () => {
    const { stories } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () =>
        guardianResponse([
          {
            ...sampleResult,
            fields: {
              trailText: "<strong>Fish &amp; chips</strong> &lt;here&gt;",
            },
          },
        ]),
    });

    expect(stories[0].summary).toBe("Fish & chips <here>");
  });

  it("defaults missing optional fields to null", async () => {
    const { stories } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () =>
        guardianResponse([
          {
            id: "x/1",
            webTitle: "Bare minimum",
            webUrl: "https://example.com/1",
            webPublicationDate: "2026-07-28T00:00:00Z",
          },
        ]),
    });

    expect(stories[0].summary).toBeNull();
    expect(stories[0].thumbnailUrl).toBeNull();
    expect(stories[0].section).toBeNull();
  });

  it("drops results missing a field the schema requires", async () => {
    const { stories } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () =>
        guardianResponse([sampleResult, { id: "x/2", webTitle: "No url" }]),
    });

    expect(stories).toHaveLength(1);
  });

  it("reports the remaining daily rate limit", async () => {
    const { rateLimitRemaining } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () => guardianResponse([], { remaining: "498" }),
    });

    expect(rateLimitRemaining).toBe(498);
  });

  it("reports a null rate limit when the header is absent", async () => {
    const { rateLimitRemaining } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () => guardianResponse([]),
    });

    expect(rateLimitRemaining).toBeNull();
  });

  it("throws on a non-2xx response without leaking the key", async () => {
    let thrown: unknown;

    try {
      await fetchGuardianStories({
        apiKey: "secret-key",
        fetchImpl: async () => new Response("nope", { status: 429 }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("429");
    // The key rides in the query string, so it must never reach a message that
    // ends up in a log.
    expect((thrown as Error).message).not.toContain("secret-key");
  });

  it("throws when the payload status is not ok", async () => {
    const attempt = fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () =>
        new Response(JSON.stringify({ response: { status: "error" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(attempt).rejects.toThrow(/status/i);
  });
});
