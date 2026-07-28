/**
 * Guardian Open Platform client.
 *
 * Fetches the newest stories and maps them onto the shape of the stories table.
 * Knows nothing about Postgres or Hono, which is what lets it be tested without
 * a database and stubbed without touching the live API.
 *
 * The API key is server-side only and must never appear in a thrown message or
 * a log line - the request URL carries it as a query parameter.
 */

const GUARDIAN_ENDPOINT = "https://content.guardianapis.com/search";

/** Guardian's maximum page size. */
const MAX_PAGE_SIZE = 50;

export interface WireStory {
  externalId: string;
  title: string;
  summary: string | null;
  url: string;
  section: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
}

export interface GuardianFetchResult {
  stories: WireStory[];
  rateLimitRemaining: number | null;
}

interface GuardianResult {
  id?: unknown;
  webTitle?: unknown;
  webUrl?: unknown;
  sectionName?: unknown;
  webPublicationDate?: unknown;
  fields?: { trailText?: unknown; thumbnail?: unknown };
}

interface GuardianPayload {
  response?: { status?: unknown; results?: unknown };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * trailText is documented as possibly containing markup. The frontend escapes
 * everything it renders, so leaving tags or entities in place would put a
 * literal "<strong>" and "&amp;" on screen. Strip once, here, at the boundary.
 */
function plainText(value: string): string {
  return (
    value
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&(?:#0?39|apos);/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // &amp; last, so "&amp;lt;" decodes to "&lt;" rather than "<".
      .replace(/&amp;/g, "&")
      .trim()
  );
}

/** Returns null for a result missing anything the stories table needs. */
export function toWireStory(result: GuardianResult): WireStory | null {
  const externalId = asString(result.id);
  const title = asString(result.webTitle);
  const url = asString(result.webUrl);
  const publishedAt = asString(result.webPublicationDate);

  if (!externalId || !title || !url || !publishedAt) {
    return null;
  }

  const summary = asString(result.fields?.trailText);

  return {
    externalId,
    title: plainText(title),
    summary: summary ? plainText(summary) : null,
    url,
    section: asString(result.sectionName),
    thumbnailUrl: asString(result.fields?.thumbnail),
    publishedAt,
  };
}

function parseRemaining(header: string | null): number | null {
  if (header === null) {
    return null;
  }

  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchGuardianStories(options: {
  apiKey: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GuardianFetchResult> {
  const { apiKey, pageSize = MAX_PAGE_SIZE, timeoutMs = 8000 } = options;

  // Read from globalThis at call time rather than at import time, so tests can
  // stub the global and this module needs no test-only seam.
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const url = new URL(GUARDIAN_ENDPOINT);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("page-size", String(Math.min(pageSize, MAX_PAGE_SIZE)));
  url.searchParams.set("order-by", "newest");
  url.searchParams.set("show-fields", "thumbnail,trailText");

  const response = await doFetch(url.toString(), {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Guardian request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GuardianPayload;

  if (payload.response?.status !== "ok") {
    throw new Error('Guardian returned a payload without status "ok"');
  }

  const results = Array.isArray(payload.response.results)
    ? (payload.response.results as GuardianResult[])
    : [];

  const stories = results
    .map(toWireStory)
    .filter((story): story is WireStory => story !== null);

  return {
    stories,
    rateLimitRemaining: parseRemaining(
      response.headers.get("x-ratelimit-remaining-day")
    ),
  };
}
