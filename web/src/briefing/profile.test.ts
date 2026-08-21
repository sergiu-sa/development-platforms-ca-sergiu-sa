// @vitest-environment happy-dom
// lib/html.ts escapes through a real element, so even these string builders reach for a document.
import { describe, expect, it } from "vitest";
import { makeBriefing } from "./briefing.fixture";
import { chromeMarkup } from "../lib/chrome";
import {
  curatorHeadMarkup,
  draftsBandMarkup,
  ledeMarkup,
  noCuratorMarkup,
  shelfErrorMarkup,
  shelfMarkup,
} from "./profile";
import type { CuratorShelf } from "./types";

function makeShelf(over: Partial<CuratorShelf> = {}): CuratorShelf {
  return {
    username: "sergiu",
    page: 1,
    pageSize: 20,
    total: 1,
    briefings: [makeBriefing()],
    ...over,
  };
}

const href = (page: number) =>
  page > 1 ? `/u/sergiu?page=${page}` : "/u/sergiu";

describe("curatorHeadMarkup", () => {
  it("names the curator", () => {
    const html = curatorHeadMarkup(makeShelf(), { withDate: false });

    expect(html).toContain(">sergiu</h1>");
  });

  it("escapes a name rather than trusting it", () => {
    // Registration cannot produce this. The escape must not depend on that staying true.
    const html = curatorHeadMarkup(
      makeShelf({ username: "<script>alert(1)</script>" }),
      { withDate: false }
    );

    expect(html).not.toContain("<script>");
  });

  it("counts briefings, and says one rather than 1 briefings", () => {
    expect(
      curatorHeadMarkup(makeShelf({ total: 1 }), { withDate: false })
    ).toContain("1 briefing filed");
    expect(
      curatorHeadMarkup(makeShelf({ total: 4 }), { withDate: false })
    ).toContain("4 briefings filed");
  });

  it("draws no facts line at all for a curator who has filed nothing", () => {
    // "0 briefings filed" reads like a broken template, and the message below already says it in words.
    const html = curatorHeadMarkup(makeShelf({ total: 0, briefings: [] }), {
      withDate: false,
    });

    expect(html).not.toContain("prof-facts");
    expect(html).not.toContain("0 briefings");
  });

  it("adds the date only when asked, because the lede already carries one", () => {
    const shelf = makeShelf();

    expect(curatorHeadMarkup(shelf, { withDate: true })).toContain(
      "Most recent"
    );
    expect(curatorHeadMarkup(shelf, { withDate: false })).not.toContain(
      "Most recent"
    );
  });
});

describe("ledeMarkup", () => {
  it("links to the briefing and labels itself", () => {
    const html = ledeMarkup(makeBriefing());

    expect(html).toContain('href="/b/the-heat-and-who-pays-7f3a"');
    expect(html).toContain("Most recent");
  });

  it("gives the photograph an empty alt, because the title is the label", () => {
    expect(ledeMarkup(makeBriefing())).toContain('alt=""');
  });

  it("draws a block rather than a broken image when there is no picture", () => {
    const html = ledeMarkup(makeBriefing({ ledeImageUrl: null }));

    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
  });

  it("escapes a title", () => {
    const html = ledeMarkup(
      makeBriefing({ title: "<script>alert(1)</script>" })
    );

    expect(html).not.toContain("<script>");
  });
});

describe("draftsBandMarkup", () => {
  it("draws nothing when there are no drafts", () => {
    expect(draftsBandMarkup(0)).toBe("");
  });

  it("counts, and says one rather than 1 drafts", () => {
    expect(draftsBandMarkup(1)).toContain("1 draft<");
    expect(draftsBandMarkup(3)).toContain("3 drafts<");
  });

  it("says the thing that makes it worth showing at all", () => {
    expect(draftsBandMarkup(2)).toContain("Only you can see these.");
    expect(draftsBandMarkup(2)).toContain('href="/build.html"');
  });
});

describe("shelfMarkup", () => {
  it("draws the newest briefing as the lede and the rest as cards", () => {
    const shelf = makeShelf({
      total: 3,
      briefings: [
        makeBriefing({ slug: "one-aaaa", title: "First" }),
        makeBriefing({ slug: "two-bbbb", title: "Second" }),
        makeBriefing({ slug: "three-cccc", title: "Third" }),
      ],
    });

    const html = shelfMarkup({ shelf, href });

    expect(html).toContain("prof-lede-title");
    expect(html).toContain("First");
    expect(html).toContain("Earlier");
    // The lede is not repeated as a card below itself.
    expect(html.match(/one-aaaa/g)).toHaveLength(1);
  });

  it("does not lead on a later page, where Most recent would be a lie", () => {
    const shelf = makeShelf({ page: 2, total: 45 });

    const html = shelfMarkup({ shelf, href });

    expect(html).not.toContain("prof-lede-title");
  });

  it("names no most-recent date on a later page, because it does not know one", () => {
    // The header only ever sees the briefings on the page it was handed, so on page three `briefings[0]` is the twenty-first newest.
    // Printing its date as "Most recent" is simply false.
    const html = shelfMarkup({
      shelf: makeShelf({ page: 3, total: 45 }),
      href,
    });

    expect(html).not.toContain("Most recent");
  });

  it("drops the byline from its cards, where every one carries the same name", () => {
    const shelf = makeShelf({
      total: 2,
      briefings: [
        makeBriefing({ slug: "a-aaaa" }),
        makeBriefing({ slug: "b-bbbb" }),
      ],
    });

    expect(shelfMarkup({ shelf, href })).not.toContain("By sergiu");
  });

  it("escapes the curator's name in the empty state's sentence", () => {
    // messageMarkup is the one builder that does not escape its body, so the caller must.
    // Registration cannot produce this name; the escape is the control and the pattern is the backstop.
    const shelf = makeShelf({
      total: 0,
      briefings: [],
      username: "<script>alert(1)</script>",
    });

    expect(shelfMarkup({ shelf, href })).not.toContain("<script>alert(1)");
  });

  it("invites rather than shrugs when nothing has been filed", () => {
    const shelf = makeShelf({ total: 0, briefings: [] });

    const html = shelfMarkup({ shelf, href });

    expect(html).toContain("Nothing filed yet");
    expect(html).toContain("When sergiu files a briefing");
  });

  it("leaves the drafts slot on every profile, empty", () => {
    // Drawn with the first paint and filled later, so adding the band never redraws the shelf under somebody who has started tabbing through it.
    const html = shelfMarkup({ shelf: makeShelf(), href });

    expect(html).toContain('id="prof-drafts"');
    expect(html).not.toContain("prof-drafts-in");
  });
});

/**
 * The frame, which the first build of this page did not have at all.
 *
 * In production the server composes the document and emits nothing but an empty `#root`, so a bar written into `u.html` would exist in development and vanish on the deployed site.
 * It has to come from here.
 *
 * Every test above passed while this page had no wordmark, no way back to the wire and no way to sign in;
 *  because every one of them was asking about the shelf, which was perfect.
 * A stranger arriving from a byline had nowhere to go.
 */
describe("the page's frame", () => {
  const framed: Array<[string, string]> = [
    ["a populated shelf", shelfMarkup({ shelf: makeShelf(), href })],
    [
      "a curator who has filed nothing",
      shelfMarkup({ shelf: makeShelf({ total: 0, briefings: [] }), href }),
    ],
    ["a name nobody has", noCuratorMarkup()],
    ["a failed read", shelfErrorMarkup()],
  ];

  for (const [state, html] of framed) {
    it(`gives ${state} a bar and a way back`, () => {
      expect(html).toContain("deskbar");
      expect(html).toContain('class="word"');
      expect(html).toContain('href="/index.html"');
    });

    it(`gives ${state} the account controls updateNavigation fills in`, () => {
      // The ids have to be in the markup before updateNavigation runs, which is why the page calls it after painting rather than at import.
      expect(html).toContain('id="nav-login"');
      expect(html).toContain('id="nav-user"');
      expect(html).toContain('id="nav-logout"');
    });
  }

  it("puts the shelf in a main landmark", () => {
    expect(shelfMarkup({ shelf: makeShelf(), href })).toContain("<main>");
  });

  it("divides the lede from the rest with a real heading", () => {
    // h1 then h2. As a styled paragraph it left the page with one heading and no way to jump past the lede.
    const shelf = makeShelf({
      total: 2,
      briefings: [
        makeBriefing({ slug: "a-aaaa" }),
        makeBriefing({ slug: "b-bbbb" }),
      ],
    });

    expect(shelfMarkup({ shelf, href })).toContain("<h2");
  });

  it("signs off in the footer, where -30- is allowed to appear", () => {
    expect(chromeMarkup()).not.toContain("-30-");
    expect(shelfMarkup({ shelf: makeShelf(), href })).toContain("-30-");
  });
});
