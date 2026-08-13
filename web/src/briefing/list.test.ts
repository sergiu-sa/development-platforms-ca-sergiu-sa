// @vitest-environment happy-dom
// lib/html.ts escapes through a real element, so even these string builders reach for a document.
import { describe, expect, it } from "vitest";
import { makeBriefing } from "./briefing.fixture";
import {
  briefingCardMarkup,
  briefingListMarkup,
  noBriefingsMarkup,
} from "./list";

describe("briefingCardMarkup", () => {
  it("links to the briefing's own address", () => {
    const html = briefingCardMarkup(makeBriefing());

    expect(html).toContain('href="/b/the-heat-and-who-pays-7f3a"');
  });

  it("escapes a slug rather than trusting it in a URL", () => {
    const html = briefingCardMarkup(
      makeBriefing({ slug: 'x" onmouseover="alert(1)' })
    );

    expect(html).not.toContain('onmouseover="alert(1)"');
  });

  it("escapes a title", () => {
    const html = briefingCardMarkup(
      makeBriefing({ title: "<script>alert(1)</script>" })
    );

    expect(html).not.toContain("<script>");
  });

  it("gives the lede photograph an empty alt, because the title is the label", () => {
    expect(briefingCardMarkup(makeBriefing())).toContain('alt=""');
  });

  it("draws no image element for a briefing with no picture", () => {
    const html = briefingCardMarkup(makeBriefing({ ledeImageUrl: null }));

    expect(html).not.toContain("<img");
  });

  it("refuses a picture whose URL is not really http(s)", () => {
    const html = briefingCardMarkup(
      makeBriefing({ ledeImageUrl: "javascript:alert(1)" })
    );

    expect(html).not.toContain("javascript:");
  });

  it("counts one story without pluralising it", () => {
    expect(briefingCardMarkup(makeBriefing({ itemCount: 1 }))).toContain(
      "1 story<"
    );
    expect(briefingCardMarkup(makeBriefing({ itemCount: 3 }))).toContain(
      "3 stories"
    );
  });

  it("shortens a long intro on a word boundary", () => {
    const intro = "word ".repeat(60).trim();
    const html = briefingCardMarkup(makeBriefing({ intro }));

    expect(html).toContain("...");
    expect(html).not.toContain("wor...");
  });

  it("omits the intro entirely when there is none", () => {
    const html = briefingCardMarkup(makeBriefing({ intro: null }));

    expect(html).not.toContain("bcard-intro");
  });

  it("names the curator", () => {
    expect(briefingCardMarkup(makeBriefing())).toContain("By sergiu");
  });
});

describe("briefingListMarkup", () => {
  it("draws one card per briefing, in the order given", () => {
    const html = briefingListMarkup([
      makeBriefing({ slug: "first-0001", title: "First" }),
      makeBriefing({ slug: "second-0002", title: "Second" }),
    ]);

    expect(html.match(/class="bcard"/g)).toHaveLength(2);
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
  });

  it("is a list, so the count is announced", () => {
    const html = briefingListMarkup([makeBriefing()]);

    expect(html.startsWith("<ul")).toBe(true);
    expect(html).toContain("<li");
  });
});

describe("noBriefingsMarkup", () => {
  it("invites rather than apologises, and spends no -30-", () => {
    const html = noBriefingsMarkup();

    expect(html).toContain("Nothing filed yet");
    expect(html).not.toContain("-30-");
    expect(html).not.toMatch(/sorry|oops/i);
  });
});
