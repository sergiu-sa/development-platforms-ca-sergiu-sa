/**
 * The wire's response contract.
 *
 * `Story` mirrors `WireStoryRow` in `src/modules/wire/wire.service.ts` rather
 * than being a view model: the route passes service objects straight through,
 * so this is what arrives on the wire, not a reshaping of it.
 */

export interface Story {
  id: number;
  title: string;
  summary: string | null;
  standfirst: string | null;
  byline: string | null;
  url: string;
  section: string | null;
  pillar: string | null;
  /**
   * Already resolved to one value. The Guardian sends several tone tags on
   * most stories and `wire.guardian.ts` applies the precedence at ingest, so
   * there is nothing to resolve here.
   *
   * Typed as a plain string rather than a union on purpose. The set of tones
   * is already declared twice - a TypeScript union in `src/` and a Postgres
   * enum - and a third copy here would be the one free to drift. Taking it as
   * a string means an unrecognised value renders as News instead of breaking.
   */
  tone: string;
  wordCount: number | null;
  starRating: number | null;
  /** 500px. Predates the 1000px image, so some rows have only this. */
  thumbnailUrl: string | null;
  /**
   * 1000px, and genuinely nullable: 327 rows stored before phase 1 have none,
   * and only the newest 50 stories are ever refreshed, so they never
   * self-correct. The card falls back rather than assuming.
   */
  imageUrl: string | null;
  imageAlt: string | null;
  imageCredit: string | null;
  publishedAt: string;
}

export interface WireResponse {
  success: boolean;
  stale: boolean;
  fetchedAt?: string | null;
  page?: number;
  pageSize?: number;
  total?: number;
  stories: Story[];
}

/** What a reader has done with a story. Absent means undecided. */
export type Decision = "saved" | "skipped";

/**
 * Which of the five cards a story is drawn as. Chosen by the tone tag, never
 * by reading the headline.
 */
export type Variant = "live" | "opinion" | "review" | "feature" | "news";
