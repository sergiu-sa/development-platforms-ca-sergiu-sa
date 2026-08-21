/**
 * The parts of a server-composed HTML document that belong to no one page.
 *
 * `/b/:slug` was the first page this server generates rather than serves; `/u/:username` is the second. Most of what is here is shared by both, and it lives here instead of being copied - which matters most for the escapers and the social-card tags, because a copied escaper is a fix that only ever fixes one page and a copied tag block drifts the moment one page gains an `og:locale`.
 *
 * `truncateWords` is the exception and is honest about it: only the briefing shell calls it, because a curator's description is built from a count rather than from prose. It is generic, it is tested, and moving it back beside one caller would buy nothing - but it is not here because two pages needed it.
 *
 * Everything here is about *documents*, not about briefings or curators.
 * A page's own head - its title, its og: tags, whatever it knows how to say about itself - is built by that page's shell and handed in.
 *
 * The module imports nothing on purpose.
 * It is composed into responses on Vercel, where the whole point is that it costs the function nothing to load.
 */

/**
 * Where the build puts the stylesheet every page shares.
 *
 * This filename is written into the documents below, so it cannot carry a content hash and cannot be allowed to move;
 *  `vite.config.ts` names it outright and refuses a build that would split the CSS into two chunks claiming it.
 * The per-page script is passed in rather than named here, because each generated page has its own entry.
 */
export const STYLESHEET = "/assets/lede.css";

/**
 * For text landing inside a `content="..."` attribute.
 *
 * Quotes matter most: a title carrying one would otherwise close the attribute and turn the rest of the value into markup.
 * Safe on text content too, where `&quot;` simply renders as a quote, which is why the loading line below goes through it as well.
 */
export function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * For JSON landing inside a `<script type="application/json">` block.
 *
 * Escaping `<` is what stops a title or a note carrying the sequence that ends a script element;
 *  the parser looks for that text and does not care that it sits inside a string.
 * JSON reads the escape straight back, so the client receives exactly what the server held.
 */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function metaTag(property: string, content: string): string {
  return `<meta property="${property}" content="${attr(content)}" />`;
}

export function nameTag(name: string, content: string): string {
  return `<meta name="${name}" content="${attr(content)}" />`;
}

/**
 * Prose cut to a length, on a word boundary, so a preview card does not end mid-word.
 *
 * A null or blank value gives the empty string rather than the word "null", because every caller is describing something optional.
 */
export function truncateWords(text: string | null, limit: number): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= limit) return trimmed;

  const cut = trimmed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

/**
 * The head for a page with nothing it may describe.
 *
 * Two different situations share it, and that sharing is the point on `/b/:slug`: a draft somebody else owns and an address that never existed produce the same bytes, so the document cannot become the thing that tells them apart.
 * `noindex` because there is nothing here worth a search result, and the generic og: trio so a pasted link still says what the site is rather than previewing as a bare URL.
 */
export function fallbackHead(title: string): string {
  return (
    `<title>${attr(title)}</title>` +
    nameTag("robots", "noindex") +
    metaTag("og:title", "Lede") +
    metaTag(
      "og:description",
      "A live news wire, triaged one story at a time."
    ) +
    metaTag("og:type", "website")
  );
}

export interface SocialHead {
  /**
   * The title a preview card shows.
   *
   * Deliberately separate from `documentTitle`, and the split is not cosmetic:
   * a briefing's tab says "The heat, and who pays - Lede" while its card says
   * "The heat, and who pays", because the site name is orientation in a tab and
   * noise in a headline somebody is deciding whether to click. Collapsing the
   * two was caught by comparing the generated document against the shipped one.
   */
  title: string;
  /** What the browser tab says. Defaults to `title` where the two are the same. */
  documentTitle?: string;
  /** One sentence, already trimmed to whatever length the page thinks fits. */
  description: string;
  /** Whose page this is. Both generated pages have one. */
  author: string;
  /** Absolute, so a scraper can follow it. */
  url: string;
  /** The picture standing for this page, or null to omit it rather than point at nothing. */
  image: string | null;
  /** `article` for a briefing, `profile` for a curator. */
  type: string;
  /** Tags only this kind of page has, already built. */
  extra?: string;
}

/**
 * The tags that make a pasted link render as a card.
 *
 * Fourteen tags in a fixed order, and both generated pages want all of them - which is why this is here rather than written out twice.
 * The first version of phase 11 did copy it, and the copies differed in exactly three values while sharing every mistake either of them could later make: an `og:locale`, an `article:published_time`, a fix to when `summary_large_image` is the right card. Nothing failed when only one was edited, because each page's test asserts only its own tags.
 *
 * `og:image` and `twitter:image` are omitted rather than emitted empty, because a card pointing at nothing renders worse than a card with no picture - and the twitter card type follows the same decision, so the two cannot disagree.
 */
export function socialHead({
  title,
  documentTitle,
  description,
  author,
  url,
  image,
  type,
  extra = "",
}: SocialHead): string {
  return (
    `<title>${attr(documentTitle ?? title)}</title>` +
    nameTag("description", description) +
    nameTag("author", author) +
    metaTag("og:title", title) +
    metaTag("og:description", description) +
    metaTag("og:type", type) +
    extra +
    metaTag("og:url", url) +
    metaTag("og:site_name", "Lede") +
    (image ? metaTag("og:image", image) : "") +
    // Twitter reads its own names rather than the og: properties for these two.
    nameTag("twitter:card", image ? "summary_large_image" : "summary") +
    nameTag("twitter:title", title) +
    nameTag("twitter:description", description) +
    (image ? nameTag("twitter:image", image) : "") +
    `<link rel="canonical" href="${attr(url)}" />`
  );
}

export interface PageDocument {
  /** What this page knows how to say about itself: its title and its meta tags. */
  head: string;
  /** The module the browser runs. Named by the build and never hashed, because this string is written into the document. */
  script: string;
  /** What sits in `#root` until that module paints. A literal, always. */
  loading: string;
  /**
   * A payload inlined into the document so the page pays no second round trip for what the server has already read.
   * Null when there is nothing to inline - which is also what keeps an undescribable page from carrying a clue about why.
   */
  data?: { id: string; value: unknown } | null;
}

/**
 * The document itself.
 *
 * Composed rather than read off disk, and that was measured rather than assumed:
 * `includeFiles` cannot carry `dist/web` into the function, checked with a real `vercel build` against both `{src/**,dist/web/**}` and `dist/web/**` alone, and the bundle contained no HTML either way.
 *
 * Only the head is built on the server. The body is rendered in the browser like every other page here, because two renderers for one piece of content is a cost this project has already paid once.
 * Social scrapers read meta tags without running a line of JavaScript, which is the whole reason the head is not left to the client too.
 */
export function buildDocument({
  head,
  script,
  loading,
  data,
}: PageDocument): string {
  const payload = data
    ? `<script type="application/json" id="${data.id}">` +
      `${inlineJson(data.value)}</script>`
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
    `<div id="root"><p class="m quiet">${attr(loading)}</p></div>` +
    payload +
    `<script type="module" src="${script}"></script>` +
    `</body>` +
    `</html>`
  );
}
