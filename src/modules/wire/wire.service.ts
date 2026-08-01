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
import type { StoryTone, WireStory } from "./wire.guardian.js";

export const WIRE_PAGE_SIZE = 20;

export interface WireStoryRow {
  id: number;
  title: string;
  summary: string | null;
  standfirst: string | null;
  byline: string | null;
  url: string;
  section: string | null;
  pillar: string | null;
  tone: StoryTone;
  wordCount: number | null;
  starRating: number | null;
  thumbnailUrl: string | null;
  /**
   * Nullable on the way out even though the client guarantees it on the way
   * in: rows stored before the column existed have none, and only the newest
   * 50 stories are ever refreshed.
   */
  imageUrl: string | null;
  imageAlt: string | null;
  imageCredit: string | null;
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
       (external_id, title, summary, standfirst, byline, url, section, pillar,
        tone, word_count, star_rating, thumbnail_url, image_url, image_alt,
        image_credit, published_at)
     SELECT * FROM UNNEST(
       $1::text[],       $2::text[],     $3::text[],        $4::text[],
       $5::text[],       $6::text[],     $7::text[],        $8::text[],
       $9::story_tone[], $10::int[],     $11::smallint[],   $12::text[],
       $13::text[],      $14::text[],    $15::text[],       $16::timestamptz[]
     )
     ON CONFLICT (external_id) DO UPDATE SET
       title         = EXCLUDED.title,
       summary       = EXCLUDED.summary,
       standfirst    = EXCLUDED.standfirst,
       byline        = EXCLUDED.byline,
       url           = EXCLUDED.url,
       section       = EXCLUDED.section,
       pillar        = EXCLUDED.pillar,
       tone          = EXCLUDED.tone,
       word_count    = EXCLUDED.word_count,
       star_rating   = EXCLUDED.star_rating,
       thumbnail_url = EXCLUDED.thumbnail_url,
       image_url     = EXCLUDED.image_url,
       image_alt     = EXCLUDED.image_alt,
       image_credit  = EXCLUDED.image_credit,
       published_at  = EXCLUDED.published_at,
       fetched_at    = now()`,
    // One entry per column above, in the same order. A story field landing in
    // the wrong column would still be valid SQL, so tests/wire.test.ts stores
    // a distinct value in every field and reads them all back.
    [
      stories.map((story) => story.externalId),
      stories.map((story) => story.title),
      stories.map((story) => story.summary),
      stories.map((story) => story.standfirst),
      stories.map((story) => story.byline),
      stories.map((story) => story.url),
      stories.map((story) => story.section),
      stories.map((story) => story.pillar),
      stories.map((story) => story.tone),
      stories.map((story) => story.wordCount),
      stories.map((story) => story.starRating),
      stories.map((story) => story.thumbnailUrl),
      stories.map((story) => story.imageUrl),
      stories.map((story) => story.imageAlt),
      stories.map((story) => story.imageCredit),
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
  standfirst: string | null;
  byline: string | null;
  url: string;
  section: string | null;
  pillar: string | null;
  tone: StoryTone;
  word_count: number | null;
  star_rating: number | null;
  thumbnail_url: string | null;
  image_url: string | null;
  image_alt: string | null;
  image_credit: string | null;
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
    `SELECT id, title, summary, standfirst, byline, url, section, pillar,
            tone, word_count, star_rating, thumbnail_url, image_url,
            image_alt, image_credit, published_at,
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
      standfirst: row.standfirst,
      byline: row.byline,
      url: row.url,
      section: row.section,
      pillar: row.pillar,
      tone: row.tone,
      wordCount: row.word_count,
      starRating: row.star_rating,
      thumbnailUrl: row.thumbnail_url,
      imageUrl: row.image_url,
      imageAlt: row.image_alt,
      imageCredit: row.image_credit,
      publishedAt: row.published_at.toISOString(),
    })),
    // COUNT() comes back as a bigint, which pg hands over as a string.
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    stale: !state.is_fresh,
    fetchedAt: state.last_success_at?.toISOString() ?? null,
  };
}
