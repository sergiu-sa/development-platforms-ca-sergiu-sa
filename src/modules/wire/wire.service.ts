/**
 * Wire cache.
 *
 * Every response is served from Postgres. An upstream call only ever refills
 * the cache, never serves a request directly, which is what makes the
 * Guardian's 500-requests-per-day limit independent of how much traffic
 * arrives.
 */

import { pool } from "../../db/connection.js";
import { config } from "../../config/env.js";
import { fetchGuardianStories } from "./wire.guardian.js";
import type { WireStory } from "./wire.guardian.js";

export const WIRE_PAGE_SIZE = 20;

export interface WireStoryRow {
  id: number;
  title: string;
  summary: string | null;
  url: string;
  section: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
}

export interface WirePage {
  stories: WireStoryRow[];
  total: number;
  stale: boolean;
  fetchedAt: string | null;
}

interface SyncRow {
  last_success_at: Date | null;
  is_fresh: boolean;
}

/** Reads cache state. No row means the wire has never been filled. */
async function readSyncState(): Promise<SyncRow> {
  const { rows } = await pool.query<SyncRow>(
    `SELECT last_success_at,
            (last_success_at IS NOT NULL
              AND last_success_at > now() - make_interval(mins => $1::int))
              AS is_fresh
       FROM wire_sync`,
    [config.wireTtlMinutes]
  );

  return rows[0] ?? { last_success_at: null, is_fresh: false };
}

/**
 * Tries to become the one caller allowed to hit upstream right now.
 *
 * One atomic statement does two jobs. The WHERE clause enforces the retry
 * cooldown, so a failing upstream is retried on a timer rather than on every
 * request. The row lock serialises concurrent callers, so ten simultaneous
 * cold-cache requests produce one upstream call rather than ten.
 *
 * Returns false when someone else holds the claim or the cooldown has not
 * elapsed - in both cases the right move is to serve what is cached.
 */
async function claimRefresh(): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO wire_sync (id, last_attempt_at)
     VALUES (TRUE, now())
     ON CONFLICT (id) DO UPDATE
       SET last_attempt_at = now()
       WHERE wire_sync.last_attempt_at
             < now() - make_interval(mins => $1::int)
     RETURNING id`,
    [config.wireRetryCooldownMinutes]
  );

  return rowCount === 1;
}

/**
 * Bulk upsert via UNNEST: one round trip for the whole page rather than one
 * per story. fetched_at is refreshed on conflict so a story's cache age
 * reflects when it was last seen upstream.
 */
async function storeStories(stories: WireStory[]): Promise<void> {
  if (stories.length === 0) {
    return;
  }

  await pool.query(
    `INSERT INTO stories
       (external_id, title, summary, url, section, thumbnail_url, published_at)
     SELECT * FROM UNNEST(
       $1::text[], $2::text[], $3::text[], $4::text[],
       $5::text[], $6::text[], $7::timestamptz[]
     )
     ON CONFLICT (external_id) DO UPDATE SET
       title         = EXCLUDED.title,
       summary       = EXCLUDED.summary,
       url           = EXCLUDED.url,
       section       = EXCLUDED.section,
       thumbnail_url = EXCLUDED.thumbnail_url,
       published_at  = EXCLUDED.published_at,
       fetched_at    = now()`,
    [
      stories.map((story) => story.externalId),
      stories.map((story) => story.title),
      stories.map((story) => story.summary),
      stories.map((story) => story.url),
      stories.map((story) => story.section),
      stories.map((story) => story.thumbnailUrl),
      stories.map((story) => story.publishedAt),
    ]
  );
}

async function recordSuccess(remaining: number | null): Promise<void> {
  await pool.query(
    `UPDATE wire_sync
        SET last_success_at = now(),
            last_error = NULL,
            rate_limit_remaining = $1`,
    [remaining]
  );
}

async function recordFailure(message: string): Promise<void> {
  await pool.query("UPDATE wire_sync SET last_error = $1", [
    message.slice(0, 500),
  ]);
}

/** Refills the cache if it is stale and this caller wins the claim. */
async function refreshIfNeeded(): Promise<void> {
  const state = await readSyncState();

  if (state.is_fresh) {
    return;
  }

  if (!(await claimRefresh())) {
    return;
  }

  try {
    const { stories, rateLimitRemaining } = await fetchGuardianStories({
      apiKey: config.guardianApiKey,
    });

    await storeStories(stories);
    await recordSuccess(rateLimitRemaining);

    if (rateLimitRemaining !== null && rateLimitRemaining < 50) {
      console.warn(
        `Guardian daily rate limit running low: ${rateLimitRemaining} left`
      );
    }
  } catch (error) {
    // Deliberately swallowed. A failed refill must never fail the request -
    // the caller serves whatever is cached and flags it stale.
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Wire refresh failed:", message);
    await recordFailure(message);
  }
}

interface StoryQueryRow {
  id: number;
  title: string;
  summary: string | null;
  url: string;
  section: string | null;
  thumbnail_url: string | null;
  published_at: Date;
  total_count: string;
}

export async function getWirePage(options: {
  section?: string;
  page: number;
}): Promise<WirePage> {
  await refreshIfNeeded();

  const offset = (options.page - 1) * WIRE_PAGE_SIZE;

  const { rows } = await pool.query<StoryQueryRow>(
    `SELECT id, title, summary, url, section, thumbnail_url, published_at,
            COUNT(*) OVER () AS total_count
       FROM stories
      WHERE ($1::text IS NULL OR LOWER(section) = LOWER($1))
      ORDER BY published_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [options.section ?? null, WIRE_PAGE_SIZE, offset]
  );

  // Re-read after the refresh so staleness reflects the attempt just made.
  const state = await readSyncState();

  return {
    stories: rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      section: row.section,
      thumbnailUrl: row.thumbnail_url,
      publishedAt: row.published_at.toISOString(),
    })),
    // COUNT() comes back as a bigint, which pg hands over as a string.
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    stale: !state.is_fresh,
    fetchedAt: state.last_success_at?.toISOString() ?? null,
  };
}
