/**
 * The head `/b/:slug` puts on its document.
 *
 * This exists for one reason:
 * a link to a briefing has to preview properly when somebody pastes it into Slack or WhatsApp, and those scrapers read meta tags without running a line of JavaScript.
 *
 * The skeleton, the two escapers and the word-boundary cut moved to `src/html/page-shell.ts` in phase 11, at their second use.
 * What is left here is the part that is actually about briefings: which of a briefing's fields become which tags.
 */

import {
  buildDocument,
  fallbackHead,
  socialHead,
  truncateWords,
} from "../../html/page-shell.js";
import type { Briefing } from "./briefings.service.js";

/** This page's entry chunk. Pinned by `vite.config.ts`, because it is named here. */
const SCRIPT = "/assets/briefing.js";

/** The id the client looks for when reading the briefing back out. */
const INLINED_ID = "briefing-data";

/** How much of the intro a preview card gets before it is cut. */
const DESCRIPTION_LIMIT = 200;

export interface BriefingPageInput {
  /**
   * The briefing, or null when there is nothing this request may be told about.
   * Null covers a draft and an address that never existed alike;
   *  the route cannot tell them apart and neither can this.
   */
  briefing: Briefing | null;
  /** Scheme and host of the deployment answering, for absolute og:url. */
  origin: string;
  slug: string;
}

export function buildBriefingPage({
  briefing,
  origin,
  slug,
}: BriefingPageInput): string {
  return buildDocument({
    // Nothing about the request reaches the shell when there is no briefing to describe - not the slug, not a hint of why;
    //  so a draft and a made-up address produce the same bytes.
    // A test pins that equality.
    head: briefing
      ? describedHead(briefing, origin, slug)
      : fallbackHead("Briefing - Lede"),
    script: SCRIPT,
    loading: "Loading this briefing...",
    data: briefing ? { id: INLINED_ID, value: briefing } : null,
  });
}

/** The head of a briefing anybody may read. */
function describedHead(
  briefing: Briefing,
  origin: string,
  slug: string
): string {
  // The service already worked this out - position 1's wide image, falling back to its thumbnail;
  //  and puts it on every summary.
  // Deriving it again here from `items[0].story` would be a second definition of "the lede's picture", in the one place where a wrong answer ships to Slack rather than to a screen.
  return socialHead({
    title: briefing.title,
    documentTitle: `${briefing.title} - Lede`,
    description: truncateWords(briefing.intro, DESCRIPTION_LIMIT),
    author: briefing.author.username,
    url: `${origin}/b/${slug}`,
    image: briefing.ledeImageUrl,
    type: "article",
  });
}
