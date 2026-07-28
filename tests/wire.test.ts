/**
 * Wire endpoint tests.
 *
 * The upstream fetch is stubbed in every case - see tests/helpers/guardian.ts.
 * A live call here would spend the 500/day budget on every CI run.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { get } from "./helpers/request.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { pool } from "../src/db/connection.js";
import { installGuardianStub, guardianResult } from "./helpers/guardian.js";
import type { GuardianStub } from "./helpers/guardian.js";

let guardian: GuardianStub;

/** Ages the cache so the next request treats it as stale. */
async function expireCache(): Promise<void> {
  await pool.query(
    `UPDATE wire_sync
        SET last_success_at = now() - interval '1 day',
            last_attempt_at = now() - interval '1 day'`
  );
}

beforeAll(async () => {
  await createSchema();
});

beforeEach(async () => {
  await resetDatabase();
  guardian = installGuardianStub();
  guardian.serve([guardianResult()]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDatabase();
});

describe("GET /api/wire", () => {
  it("fills a cold cache from upstream and serves the stories", async () => {
    const response = await get("/api/wire");

    expect(response.status).toBe(200);
    expect(guardian.calls()).toBe(1);
    expect(response.body.success).toBe(true);
    expect(response.body.stale).toBe(false);
    expect(response.body.stories).toHaveLength(1);
    expect(response.body.stories[0]).toMatchObject({
      title: "Example story",
      summary: "A summary of the example story",
      section: "World",
      url: "https://www.theguardian.com/world/2026/jul/28/example-story",
      thumbnailUrl: "https://media.guim.co.uk/example/500.jpg",
    });
  });

  it("serves a warm cache without calling upstream again", async () => {
    await get("/api/wire");
    const second = await get("/api/wire");

    expect(guardian.calls()).toBe(1);
    expect(second.body.stories).toHaveLength(1);
    expect(second.body.stale).toBe(false);
  });

  it("upserts by external_id rather than duplicating a story", async () => {
    await get("/api/wire");
    await expireCache();
    guardian.serve([guardianResult({ webTitle: "Example story, updated" })]);

    const response = await get("/api/wire");

    expect(guardian.calls()).toBe(2);
    expect(response.body.stories).toHaveLength(1);
    expect(response.body.stories[0].title).toBe("Example story, updated");
  });

  // The homepage must never error because a third party had a bad afternoon.
  it("serves stale cache when upstream fails", async () => {
    await get("/api/wire");
    await expireCache();
    guardian.fail();

    const response = await get("/api/wire");

    expect(response.status).toBe(200);
    expect(response.body.stale).toBe(true);
    expect(response.body.stories).toHaveLength(1);
    expect(response.body.stories[0].title).toBe("Example story");
  });

  it("returns an empty wire rather than an error when upstream fails cold", async () => {
    guardian.fail();

    const response = await get("/api/wire");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.stale).toBe(true);
    expect(response.body.stories).toEqual([]);
  });

  // Without this, an outage would retry on every page load and drain the
  // 500/day budget in minutes.
  it("does not retry upstream inside the cooldown after a failure", async () => {
    guardian.fail();

    await get("/api/wire");
    await get("/api/wire");
    await get("/api/wire");

    expect(guardian.calls()).toBe(1);
  });

  // The latency matters: without it the requests could quietly serialise and
  // this would pass even if the refresh claim did nothing.
  it("makes one upstream call for concurrent cold-cache requests", async () => {
    guardian.setLatency(50);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => get("/api/wire"))
    );

    expect(guardian.calls()).toBe(1);
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });

  it("persists the remaining daily rate limit", async () => {
    guardian.setRemaining("437");

    await get("/api/wire");

    const { rows } = await pool.query<{ rate_limit_remaining: number }>(
      "SELECT rate_limit_remaining FROM wire_sync"
    );
    expect(rows[0].rate_limit_remaining).toBe(437);
  });

  it("records the error message when a refresh fails", async () => {
    guardian.fail(503);

    await get("/api/wire");

    const { rows } = await pool.query<{
      last_error: string | null;
      last_success_at: Date | null;
    }>("SELECT last_error, last_success_at FROM wire_sync");

    expect(rows[0].last_error).toContain("503");
    expect(rows[0].last_success_at).toBeNull();
  });

  it("filters by section, case-insensitively", async () => {
    guardian.serve([
      guardianResult({ id: "world/1", sectionName: "World" }),
      guardianResult({ id: "sport/1", sectionName: "Sport" }),
    ]);

    const response = await get("/api/wire?section=sport");

    expect(response.body.stories).toHaveLength(1);
    expect(response.body.stories[0].section).toBe("Sport");
    expect(response.body.total).toBe(1);
  });

  it("paginates, newest first", async () => {
    guardian.serve(
      Array.from({ length: 25 }, (_, index) =>
        guardianResult({
          id: `world/${index}`,
          webTitle: `Story ${index}`,
          // Index 0 is the newest.
          webPublicationDate: new Date(
            Date.UTC(2026, 6, 28, 12) - index * 60_000
          ).toISOString(),
        })
      )
    );

    const first = await get("/api/wire");
    const second = await get("/api/wire?page=2");

    expect(first.body.stories).toHaveLength(20);
    expect(first.body.stories[0].title).toBe("Story 0");
    expect(first.body.total).toBe(25);
    expect(second.body.stories).toHaveLength(5);
    expect(second.body.page).toBe(2);
  });

  it("rejects a page number that is not a positive integer", async () => {
    const response = await get("/api/wire?page=nonsense");

    expect(response.status).toBe(400);
  });

  it("rejects page zero", async () => {
    const response = await get("/api/wire?page=0");

    expect(response.status).toBe(400);
  });

  // A page number large enough to push the OFFSET into scientific notation
  // ("2e+21") makes Postgres reject it as a bigint, which surfaced as a 500
  // reachable straight from the URL bar.
  it("rejects a page number too large to be a valid offset", async () => {
    const response = await get("/api/wire?page=99999999999999999999");

    expect(response.status).toBe(400);
  });

  it("rejects an absurdly long run of digits", async () => {
    const response = await get(`/api/wire?page=${"9".repeat(400)}`);

    expect(response.status).toBe(400);
  });

  // The key is server-side only. It must never appear in a response body.
  it("never exposes the api key", async () => {
    const response = await get("/api/wire");

    expect(JSON.stringify(response.body)).not.toContain("api-key");
    expect(JSON.stringify(response.body)).not.toContain(
      "test_key_never_sent_anywhere"
    );
  });
});
