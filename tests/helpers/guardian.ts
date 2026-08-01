/**
 * Stubs globalThis.fetch for the wire tests.
 *
 * The Guardian allows 500 requests per day and CI runs on every push, so no
 * test may ever reach the live API. The stub throws on any URL it does not
 * recognise, which turns an accidental real call into a loud failure rather
 * than a quiet one.
 */

import { vi } from "vitest";

export interface GuardianStub {
  /** How many times the Guardian endpoint has been called. */
  calls: () => number;
  /** Serve this list on the next and subsequent calls. */
  serve: (results: unknown[]) => void;
  /** Fail every subsequent call, as an outage would. */
  fail: (status?: number) => void;
  /** Set the value of the x-ratelimit-remaining-day header. */
  setRemaining: (remaining: string | null) => void;
  /**
   * Hold each response open for this long. Used by the concurrency test to
   * guarantee callers really do overlap rather than quietly serialising, which
   * would let that test pass without the refresh claim doing anything.
   */
  setLatency: (ms: number) => void;
}

const defaultFields: Record<string, unknown> = {
  headline: "Example story",
  trailText: "A summary of the example story",
  standfirst: "The standfirst of the example story",
  byline: "Example Reporter in London",
  wordcount: "820",
  thumbnail: "https://media.guim.co.uk/example/crop/500.jpg",
};

/**
 * A result in the shape the live API returns, including the tone tags and the
 * image element the deck depends on. `fields` overrides are merged rather than
 * replaced, so a test can change one field without dropping the rest - losing
 * the thumbnail would silently drop the story from the wire.
 */
export function guardianResult(overrides: Record<string, unknown> = {}) {
  const { fields, ...rest } = overrides as {
    fields?: Record<string, unknown>;
  };

  return {
    id: "world/2026/jul/28/example-story",
    webTitle: "Example story",
    webUrl: "https://www.theguardian.com/world/2026/jul/28/example-story",
    sectionName: "World",
    pillarName: "News",
    webPublicationDate: "2026-07-28T12:00:00Z",
    tags: [{ id: "tone/news", type: "tone", webTitle: "News" }],
    elements: [
      {
        id: "main-image",
        relation: "main",
        type: "image",
        assets: [
          {
            type: "image",
            file: "https://media.guim.co.uk/example/crop/1000.jpg",
            typeData: {
              width: "1000",
              altText: "A photograph illustrating the example story",
              credit: "Photograph: Example Photographer/Reuters",
            },
          },
        ],
      },
    ],
    fields: { ...defaultFields, ...fields },
    ...rest,
  };
}

export function installGuardianStub(): GuardianStub {
  let results: unknown[] = [];
  let failStatus: number | null = null;
  let remaining: string | null = "499";
  let latencyMs = 0;
  let calls = 0;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const requested = String(input);

    if (!requested.startsWith("https://content.guardianapis.com/")) {
      throw new Error(`Unexpected network call in tests: ${requested}`);
    }

    calls += 1;

    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    if (failStatus !== null) {
      return new Response("upstream error", { status: failStatus });
    }

    return new Response(
      JSON.stringify({ response: { status: "ok", results } }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...(remaining === null
            ? {}
            : { "x-ratelimit-remaining-day": remaining }),
        },
      }
    );
  });

  return {
    calls: () => calls,
    serve: (next) => {
      results = next;
      failStatus = null;
    },
    fail: (status = 503) => {
      failStatus = status;
    },
    setRemaining: (next) => {
      remaining = next;
    },
    setLatency: (ms) => {
      latencyMs = ms;
    },
  };
}
