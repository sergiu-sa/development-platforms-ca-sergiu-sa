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

export function guardianResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "world/2026/jul/28/example-story",
    webTitle: "Example story",
    webUrl: "https://www.theguardian.com/world/2026/jul/28/example-story",
    sectionName: "World",
    webPublicationDate: "2026-07-28T12:00:00Z",
    fields: {
      trailText: "A summary of the example story",
      thumbnail: "https://media.guim.co.uk/example/500.jpg",
    },
    ...overrides,
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
