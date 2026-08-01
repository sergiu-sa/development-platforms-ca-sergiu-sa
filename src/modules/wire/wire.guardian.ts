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

const SHOW_FIELDS =
  "headline,trailText,standfirst,byline,wordcount,starRating,thumbnail";
const SHOW_TAGS = "tone";
const SHOW_ELEMENTS = "image";

/**
 * The asset width the deck renders. Guardian reports asset widths as strings
 * ("1000"), so this is compared as one - a numeric comparison silently never
 * matches and every story falls through to the thumbnail fallback.
 */
const IMAGE_WIDTH = "1000";

/** Guardian star ratings run 0-5. */
const MAX_STAR_RATING = 5;

/**
 * The five card variants.
 *
 * Order is precedence, not preference: a story usually carries several tone
 * tags - a live blog is tagged both `tone/minutebyminute` and `tone/news` -
 * so the first match down this list wins. Taking the first tag the API happens
 * to return would label most live blogs as ordinary news.
 */
/**
 * The one place the set of tones is written in TypeScript. StoryTone is derived
 * from it, so a variant added here is added to the type - listing them twice
 * would let the array fall a member short without the compiler noticing.
 *
 * The set is declared once more, unavoidably, as the story_tone enum in
 * db/schema.sql. tests/schema-drift.test.ts asserts the two agree, because a
 * tone that exists here but not there makes the bulk insert throw - and
 * refreshIfNeeded() swallows refresh errors by design, so the only symptom
 * would be a wire that quietly serves stale content forever.
 */
export const TONE_PRECEDENCE = [
  "minutebyminute",
  "reviews",
  "comment",
  "features",
  "news",
] as const;

export type StoryTone = (typeof TONE_PRECEDENCE)[number];

const TONE_TAG_PREFIX = "tone/";

export interface WireStory {
  externalId: string;
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
  /** Guaranteed: a result without an image is dropped rather than mapped. */
  imageUrl: string;
  imageAlt: string | null;
  imageCredit: string | null;
  publishedAt: string;
}

export interface StoryImage {
  url: string;
  alt: string | null;
  credit: string | null;
}

export interface GuardianFetchResult {
  stories: WireStory[];
  rateLimitRemaining: number | null;
}

interface GuardianFields {
  headline?: unknown;
  trailText?: unknown;
  standfirst?: unknown;
  byline?: unknown;
  wordcount?: unknown;
  starRating?: unknown;
  thumbnail?: unknown;
}

interface GuardianAsset {
  file?: unknown;
  typeData?: {
    width?: unknown;
    altText?: unknown;
    credit?: unknown;
    secureFile?: unknown;
  };
}

interface GuardianElement {
  relation?: unknown;
  type?: unknown;
  assets?: unknown;
}

interface GuardianTag {
  id?: unknown;
}

interface GuardianResult {
  id?: unknown;
  webTitle?: unknown;
  webUrl?: unknown;
  sectionName?: unknown;
  pillarName?: unknown;
  webPublicationDate?: unknown;
  fields?: GuardianFields;
  tags?: unknown;
  elements?: unknown;
}

interface GuardianPayload {
  response?: { status?: unknown; results?: unknown };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * trailText and standfirst are documented as possibly containing markup. The
 * frontend escapes everything it renders, so leaving tags or entities in place
 * would put a literal "<strong>" and "&amp;" on screen. Strip once, here, at
 * the boundary.
 */
function plainText(value: string): string {
  return (
    value
      // A block boundary is a word boundary. Dropping these to nothing welds
      // the last word of one paragraph onto the first of the next - a real
      // standfirst stripped to "...around GlasgowMedal table | How..." before
      // this line existed.
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote)\s*>|<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&(?:#0?39|apos);/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // &amp; last, so "&amp;lt;" decodes to "&lt;" rather than "<".
      .replace(/&amp;/g, "&")
      // Collapse what the substitutions above introduced, after the entities
      // are decoded so a decoded &nbsp; collapses too.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Every free-text field we store goes through this, so there is one rule
 * rather than a per-field judgement about which ones might carry markup.
 * Markup that strips to nothing becomes null rather than an empty string.
 */
function plainTextOrNull(value: unknown): string | null {
  const text = asString(value);

  if (text === null) {
    return null;
  }

  const stripped = plainText(text);
  return stripped.length > 0 ? stripped : null;
}

/**
 * Guardian sends wordcount and starRating as strings ("2853"), so these are
 * parsed rather than trusted. A regex rather than Number(), because Number("")
 * is 0 and Number("1.5") is 1.5 - both would store a figure the API never
 * reported.
 */
function parseInteger(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : asString(value);

  if (text === null || !/^\d+$/.test(text)) {
    return null;
  }

  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseStarRating(value: unknown): number | null {
  const parsed = parseInteger(value);
  return parsed !== null && parsed <= MAX_STAR_RATING ? parsed : null;
}

/**
 * Resolves the card variant from a result's tone tags.
 *
 * This is the single most consequential mapping in the wire: it decides which
 * card a story is drawn as. It is driven by the tag rather than by the
 * headline - matching a headline for "- live" would be wrong the moment a
 * story is *about* a live blog.
 */
export function resolveTone(tags: unknown): StoryTone {
  if (!Array.isArray(tags)) {
    return "news";
  }

  const present = new Set<string>();

  for (const tag of tags as GuardianTag[]) {
    const id = asString(tag?.id);

    if (id?.startsWith(TONE_TAG_PREFIX)) {
      present.add(id.slice(TONE_TAG_PREFIX.length));
    }
  }

  // Nothing recognised - an unknown tone or no tags at all - reads as news,
  // which is the default card.
  return TONE_PRECEDENCE.find((tone) => present.has(tone)) ?? "news";
}

function mainImageAssets(elements: unknown): GuardianAsset[] {
  if (!Array.isArray(elements)) {
    return [];
  }

  // A result carries several elements; only the main one is the story's
  // photograph.
  const main = (elements as GuardianElement[]).find(
    (element) => element?.relation === "main" && element?.type === "image"
  );

  if (!main || !Array.isArray(main.assets)) {
    return [];
  }

  return main.assets as GuardianAsset[];
}

/**
 * Guardian thumbnails are the same path with the width as the final segment,
 * so the wide variant is one substitution away. Returns null when the URL is
 * not that shape, rather than guessing at a path that may not exist.
 */
function widenThumbnail(thumbnailUrl: string | null): string | null {
  const widthSegment = /\/\d+\.jpg$/;

  if (thumbnailUrl === null || !widthSegment.test(thumbnailUrl)) {
    return null;
  }

  return thumbnailUrl.replace(widthSegment, `/${IMAGE_WIDTH}.jpg`);
}

/**
 * Picks the image the deck renders, preferring the wide asset and falling back
 * to widening the thumbnail.
 *
 * Assets are selected by their reported width rather than by position in the
 * array - the order is not part of the API's contract. Only the asset carries
 * alt text and a credit, so the fallback path has neither.
 */
export function selectImage(
  elements: unknown,
  thumbnailUrl: string | null
): StoryImage | null {
  const asset = mainImageAssets(elements).find(
    (candidate) => asString(candidate?.typeData?.width) === IMAGE_WIDTH
  );

  // secureFile and file are the same https URL on current content; preferring
  // the explicitly secure one keeps an older http asset off the page, where it
  // would be blocked as mixed content anyway.
  const assetUrl = asset
    ? (asString(asset.typeData?.secureFile) ?? asString(asset.file))
    : null;

  if (asset && assetUrl) {
    return {
      url: assetUrl,
      alt: plainTextOrNull(asset.typeData?.altText),
      credit: plainTextOrNull(asset.typeData?.credit),
    };
  }

  const widened = widenThumbnail(thumbnailUrl);
  return widened === null ? null : { url: widened, alt: null, credit: null };
}

/** Returns null for a result missing anything the stories table needs. */
export function toWireStory(result: GuardianResult): WireStory | null {
  const externalId = asString(result.id);
  // fields.headline is the editorial headline; webTitle is the fallback.
  const title = asString(result.fields?.headline) ?? asString(result.webTitle);
  const url = asString(result.webUrl);
  const publishedAt = asString(result.webPublicationDate);

  if (!externalId || !title || !url || !publishedAt) {
    return null;
  }

  const thumbnailUrl = asString(result.fields?.thumbnail);
  // The deck renders a photograph at full size, so a story with no image at
  // all has no card to be drawn into and is dropped rather than stored.
  const image = selectImage(result.elements, thumbnailUrl);

  if (image === null) {
    return null;
  }

  return {
    externalId,
    title: plainText(title),
    summary: plainTextOrNull(result.fields?.trailText),
    standfirst: plainTextOrNull(result.fields?.standfirst),
    byline: plainTextOrNull(result.fields?.byline),
    url,
    section: asString(result.sectionName),
    // pillarName gives five usable filter groups where sectionName gives
    // twenty thin ones.
    pillar: asString(result.pillarName),
    tone: resolveTone(result.tags),
    wordCount: parseInteger(result.fields?.wordcount),
    starRating: parseStarRating(result.fields?.starRating),
    thumbnailUrl,
    imageUrl: image.url,
    imageAlt: image.alt,
    imageCredit: image.credit,
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
  url.searchParams.set("show-fields", SHOW_FIELDS);
  url.searchParams.set("show-tags", SHOW_TAGS);
  url.searchParams.set("show-elements", SHOW_ELEMENTS);

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
