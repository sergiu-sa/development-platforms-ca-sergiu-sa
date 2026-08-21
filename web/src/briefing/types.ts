/**
 * What `GET /api/briefings/:slug` serves.
 *
 * Mirrors `Briefing` and `BriefingItem` in `src/modules/briefings/briefings.service.ts` rather than reshaping them:
 * the route passes service objects straight through, exactly as the wire does, so this is the response contract and not a view model.
 */

import type { Story } from "../wire/types";

export interface BriefingItem {
  id: number;
  storyId: number;
  note: string | null;
  /**
   * 1 is the lede. Derived from the order the curator set, never from a flag;
   * there is no `is_lead` column, because a boolean admits two leads or none.
   */
  position: number;
  story: Story;
}

/** A briefing without its stories, which is what the listing serves. */
export interface BriefingSummary {
  id: number;
  slug: string;
  title: string;
  intro: string | null;
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The public display name and nothing else. An email here would publish the whole userbase to anonymous visitors, which is the oldest standing rule in
   * this codebase.
   */
  author: { username: string };
  itemCount: number;
  /** The lede's photograph, standing for the briefing on a card. */
  ledeImageUrl: string | null;
}

/** A briefing and everything in it, which is what the reading view needs. */
export interface Briefing extends BriefingSummary {
  items: BriefingItem[];
}

/**
 * One curator's shelf: what `GET /api/curators/:username` returns, and what the server inlines into the document for `/u/:username`.
 *
 * Published briefings only. The endpoint has no branch on who is asking, so a curator sees the same shelf here as a stranger does; their drafts are a different question asked with a token.
 */
export interface CuratorShelf {
  username: string;
  page: number;
  pageSize: number;
  total: number;
  briefings: BriefingSummary[];
}
