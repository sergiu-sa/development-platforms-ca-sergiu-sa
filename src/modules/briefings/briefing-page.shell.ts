/**
 * The HTML document `/b/:slug` serves.
 *
 * This exists for one reason:
 * a link to a briefing has to preview properly when somebody pastes it into Slack or WhatsApp, and those scrapers read meta tags without running a line of JavaScript.
 * Everything else on this site is rendered in the browser, and so is this page's body;
 *  only its head is built here, from the briefing the route just read.
 *
 * The document is composed rather than read off disk.
 * That was measured, not assumed: 
 * `includeFiles` cannot carry `dist/web` into the function, checked with a real `vercel build` against both `{src/**,dist/web/**}` and `dist/web/**` alone, and the bundle contained no HTML either way.
 * So the two assets this references have names the build pins rather than content hashes.
 *
 * It is also why `vite.config.ts` names the stylesheet outright: that filename is written into this string, and it cannot be something that moves.
 */

import type { Briefing } from "./briefings.service.js";

/** Where the build puts the two files this document needs. */
const STYLESHEET = "/assets/lede.css";
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

/**
 * For text landing inside a `content="..."` attribute.
 *
 * Quotes matter most here: a title carrying one would otherwise close the attribute and turn the rest of the value into markup.
 */
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * For JSON landing inside a `<script type="application/json">` block.
 *
 * Escaping `<` is what stops a title or a note carrying the sequence that ends  a script element;
 *  the parser looks for that text and does not care that it sits inside a string.
 * JSON reads the escape straight back, so the client receives exactly what the server held.
 */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** The intro, trimmed on a word boundary so a preview card does not end mid-word. */
function description(intro: string | null): string {
  const text = (intro ?? "").trim();
  if (text.length <= DESCRIPTION_LIMIT) return text;

  const cut = text.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

function metaTag(property: string, content: string): string {
  return `<meta property="${property}" content="${attr(content)}" />`;
}

function nameTag(name: string, content: string): string {
  return `<meta name="${name}" content="${attr(content)}" />`;
}

export function buildBriefingPage({
  briefing,
  origin,
  slug,
}: BriefingPageInput): string {
  // Nothing about the request reaches the shell when there is no briefing to describe - not the slug, not a hint of why;
  //  so a draft and a made-up address produce the same bytes.
  // A test pins that equality.
  const head = briefing
    ? describedHead(briefing, origin, slug)
    : `<title>Briefing - Lede</title>` +
      nameTag("robots", "noindex") +
      metaTag("og:title", "Lede") +
      metaTag(
        "og:description",
        "A live news wire, triaged one story at a time."
      ) +
      metaTag("og:type", "website");

  const data = briefing
    ? `<script type="application/json" id="${INLINED_ID}">` +
      `${inlineJson(briefing)}</script>`
    : "";

  return (
    `<!doctype html>` +
    `<html lang="en">` +
    `<head>` +
    `<meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    head +
    `<link rel="stylesheet" href="${STYLESHEET}" />` +
    `</head>` +
    `<body>` +
    `<div id="root"><p class="m quiet">Loading this briefing...</p></div>` +
    data +
    `<script type="module" src="${SCRIPT}"></script>` +
    `</body>` +
    `</html>`
  );
}

/** The head of a briefing anybody may read. */
function describedHead(
  briefing: Briefing,
  origin: string,
  slug: string
): string {
  const url = `${origin}/b/${slug}`;
  const summary = description(briefing.intro);
  // The service already worked this out - position 1's wide image, falling back to its thumbnail;
  //  and puts it on every summary.
  // Deriving it again here from `items[0].story` would be a second definition of "the lede's picture", in the one place where a wrong answer ships to Slack rather than to a screen.
  const image = briefing.ledeImageUrl;

  return (
    `<title>${attr(briefing.title)} - Lede</title>` +
    nameTag("description", summary) +
    nameTag("author", briefing.author.username) +
    metaTag("og:title", briefing.title) +
    metaTag("og:description", summary) +
    metaTag("og:type", "article") +
    metaTag("og:url", url) +
    metaTag("og:site_name", "Lede") +
    (image ? metaTag("og:image", image) : "") +
    // Twitter reads its own names rather than the og: properties for these two.
    nameTag("twitter:card", image ? "summary_large_image" : "summary") +
    nameTag("twitter:title", briefing.title) +
    nameTag("twitter:description", summary) +
    (image ? nameTag("twitter:image", image) : "") +
    `<link rel="canonical" href="${attr(url)}" />`
  );
}
