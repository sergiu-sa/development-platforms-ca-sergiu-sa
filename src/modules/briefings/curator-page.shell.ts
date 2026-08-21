/**
 * The head `/u/:username` puts on its document.
 *
 * The second page this server generates, and it exists for the same reason the first does:
 * a curator's shelf is a public address somebody shares, and a scraper builds its card from meta tags without running a line of JavaScript.
 *
 * It differs from the briefing's shell in one way worth stating, because it looks like an inconsistency and is not.
 * `/b/:slug` gives a draft and an address that never existed **byte-identical** documents, since a draft is private work and the document must not become the thing that reveals it.
 * There is no equivalent here.
 * A username is public the moment it appears on a byline, and the register form already refuses one that is taken, so hiding whether a name is registered would buy nothing and cost a designed page.
 * A curator who has filed nothing gets a page saying so; a name nobody has gets a page saying that instead.
 * What this page must never do is carry a draft, and it cannot: `listByCurator` selects published rows only, with no branch on who is asking.
 */

import {
  buildDocument,
  fallbackHead,
  metaTag,
  socialHead,
} from "../../html/page-shell.js";
import type { BriefingSummary } from "./briefings.service.js";

/** This page's entry chunk. Pinned by `vite.config.ts`, because it is named here. */
const SCRIPT = "/assets/profile.js";

/** The id the client looks for when reading the shelf back out. */
const INLINED_ID = "curator-data";

/** What the client is handed, and what the page inlines. */
export interface CuratorShelf {
  username: string;
  page: number;
  pageSize: number;
  total: number;
  briefings: BriefingSummary[];
}

/**
 * What the lookup found.
 *
 * Three states, one value. `found` carries the shelf; `missing` means the database answered and nobody has that name; `unavailable` means nothing was asked or the read failed.
 *
 * The distinction between the last two is what saves a round trip, and it is the reason this page differs from `/b/:slug`.
 * A resolved `missing` is inlined as `null`, so the client can draw "no curator by that name" without asking the same question over the network again - a second function invocation and a second database round trip, on every mistyped or scanned address, each one taking the instance's single pooled connection.
 * `unavailable` inlines nothing, which is the signal that asking is still worth a request.
 * A briefing's shell cannot do this: there the two nulls must stay indistinguishable, or the document becomes the thing that reveals somebody's draft.
 */
export type CuratorLookup =
  | { state: "found"; shelf: CuratorShelf }
  | { state: "missing" }
  | { state: "unavailable" };

export interface CuratorPageInput {
  lookup: CuratorLookup;
  /** Scheme and host of the deployment answering, for absolute og:url. */
  origin: string;
}

/**
 * The requested name is deliberately not an input.
 *
 * A described page uses the *stored* spelling, off the shelf, so two casings of one name cannot advertise two canonical addresses.
 * An undescribable page uses no name at all, because the only name available there came out of the URL, and echoing somebody else's text back into a document is the habit this codebase escapes everything to avoid.
 */
export function buildCuratorPage({ lookup, origin }: CuratorPageInput): string {
  return buildDocument({
    head:
      lookup.state === "found"
        ? describedHead(lookup.shelf, origin)
        : fallbackHead("Curator - Lede"),
    script: SCRIPT,
    loading: "Loading this shelf...",
    data:
      lookup.state === "found"
        ? { id: INLINED_ID, value: lookup.shelf }
        : lookup.state === "missing"
          ? { id: INLINED_ID, value: null }
          : null,
  });
}

/** The head of a curator anybody may read. */
function describedHead(shelf: CuratorShelf, origin: string): string {
  // The stored spelling, never the requested one: usernames are unique case-insensitively, so /u/SERGIU and /u/sergiu are one page and must not advertise two canonical addresses between them.
  const name = shelf.username;
  // The page this document is actually for.
  // `og:image` already varies per page;
  //  it is the newest briefing on it;
  //  so a url fixed at page one would have previewed page three's photograph under page one's address, and declared every paged variant canonical at a page serving different content.
  const path = `${origin}/u/${encodeURIComponent(name)}`;

  return socialHead({
    title: `${name} on Lede`,
    description: describe(shelf),
    author: name,
    url: shelf.page > 1 ? `${path}?page=${shelf.page}` : path,
    // The newest briefing's photograph stands for the shelf, the same way the lede's stands for a briefing. Null on a curator who has filed nothing, and on one whose newest briefing holds no picture.
    image: shelf.briefings[0]?.ledeImageUrl ?? null,
    type: "profile",
    extra: metaTag("profile:username", name),
  });
}

/**
 * What a preview card says about a shelf.
 *
 * Built from the count rather than from anybody's prose, because a curator has no bio to quote;
 *  there is no settings screen and deliberately no plan for one.
 * The empty case gets a sentence rather than "0 briefings filed", which reads like a broken template on the one page somebody might share early.
 */
function describe(shelf: CuratorShelf): string {
  if (shelf.total === 0) {
    return `${shelf.username} has not filed a briefing yet.`;
  }

  const count = shelf.total === 1 ? "1 briefing" : `${shelf.total} briefings`;

  return `${count} filed by ${shelf.username}. The stories are the Guardian's. The writing is theirs.`;
}
