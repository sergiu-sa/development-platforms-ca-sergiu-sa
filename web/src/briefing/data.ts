/**
 * Getting the briefing, from the page or from the API.
 *
 * A published briefing arrives inlined in the document the server generated, because that server had just read it to build the Open Graph tags and making the browser ask again would be paying twice for one answer.
 * A draft does not: a document request carries no Authorization header, so the server cannot know whether the reader is its author and deliberately inlines nothing.
 * The page then asks with the token, where the question can actually be answered.
 *
 * Both routes end in the same object, so the renderer never learns which one it came from.
 */

import { getBriefing } from "../lib/api";
import type { Briefing } from "./types";

/** Where the server puts the briefing it already read. */
const INLINED_ID = "briefing-data";

/** Not exported: nothing names this type, it is only ever destructured. */
interface LoadResult {
  briefing: Briefing | null;
  /** The HTTP status, or 0 when nothing was asked or nothing answered. */
  status: number;
}

/** Enough of a shape check that a wrong payload is treated as no payload. */
function looksLikeBriefing(value: unknown): value is Briefing {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<Briefing>;

  return (
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.items)
  );
}

/**
 * The briefing the server inlined, or null.
 *
 * Never throws. The payload was written by our own server, so a broken one means something is wrong upstream;
 *  and a page that dies on its own data is worse than one that quietly asks again.
 */
export function readInlined(doc: Document): Briefing | null {
  const node = doc.getElementById(INLINED_ID);
  if (!node?.textContent) return null;

  try {
    const parsed: unknown = JSON.parse(node.textContent);

    return looksLikeBriefing(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The briefing, however it can be had.
 *
 * A 404 is not an error:
 * it is the answer a stranger gets for a draft and the answer anybody gets for an address that never existed, which the API makes deliberately identical.
 * The caller separates it from a failed connection by the status, which is why this returns one.
 */
export async function loadBriefing(
  slug: string,
  doc: Document
): Promise<LoadResult> {
  const inlined = readInlined(doc);
  if (inlined) return { briefing: inlined, status: 200 };

  // The slug is only ever needed to ask, so it is checked here rather than before the inlined read.
  // Checking first cost a real bug:
  // the generated document served at its own API path carries the briefing but no readable slug in the address, and the page threw the payload away and said the/ briefing did not exist.
  if (!slug) return { briefing: null, status: 404 };

  const { status, body } = await getBriefing(slug);

  return {
    briefing: looksLikeBriefing(body?.briefing) ? body.briefing : null,
    status,
  };
}
