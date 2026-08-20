// @vitest-environment happy-dom
// lib/html.ts escapes through a real element, so even this string builder reaches for a document.
import { describe, expect, it } from "vitest";
import { hrefForPage, pageFromLocation, pagerMarkup } from "./pager";

const href = (page: number) => hrefForPage("/u/sergiu", page);

describe("pageFromLocation", () => {
  it("opens page 1 for anything that is not a page number", () => {
    // The server does the same with the same parameter rather than refusing to draw, and the two must not disagree about what "?page=nonsense" means.
    for (const search of ["", "?page=0", "?page=-3", "?page=x", "?page=1.5"]) {
      expect(pageFromLocation(search)).toBe(1);
    }
  });

  it("reads a real page number", () => {
    expect(pageFromLocation("?page=4")).toBe(4);
  });
});

describe("hrefForPage", () => {
  it("keeps page one at the bare address rather than ?page=1", () => {
    expect(hrefForPage("/u/sergiu", 1)).toBe("/u/sergiu");
  });

  it("carries the path, so the two shelves cannot disagree about the shape", () => {
    // They already had: one page built "?page=2" and the other "/u/x?page=2".
    // Both resolve, so nothing failed and nothing would have.
    expect(hrefForPage("/u/sergiu", 2)).toBe("/u/sergiu?page=2");
    expect(hrefForPage("/briefings.html", 2)).toBe("/briefings.html?page=2");
  });
});

describe("pagerMarkup", () => {
  it("draws nothing when one page holds everything", () => {
    expect(pagerMarkup(1, 20, 12, href)).toBe("");
    expect(pagerMarkup(1, 20, 20, href)).toBe("");
  });

  it("says where you are", () => {
    expect(pagerMarkup(2, 20, 45, href)).toContain("Page 2 of 3");
  });

  it("draws no Newer on the first page, and no Older on the last", () => {
    // Not a dimmed control and not a disabled one: nothing at all, so nothing lands in the tab order and no visible text sits under the contrast floor.
    const first = pagerMarkup(1, 20, 45, href);
    const last = pagerMarkup(3, 20, 45, href);

    expect(first).not.toContain("Newer");
    expect(first).toContain("Older");
    expect(last).toContain("Newer");
    expect(last).not.toContain("Older");
  });

  it("clamps a page number past the end", () => {
    // `?page=` is whatever somebody typed.
    // Unclamped this read "Page 99 of 3" and offered a Newer link to page 98, which is also empty;
    //  the only control on a page with nothing else on it, leading nowhere.
    const html = pagerMarkup(99, 20, 45, href);

    expect(html).toContain("Page 3 of 3");
    expect(html).not.toContain("Older");
    expect(html).toContain('href="/u/sergiu?page=2"');
  });

  it("clamps a page number below one", () => {
    expect(pagerMarkup(0, 20, 45, href)).toContain("Page 1 of 3");
  });

  it("sends page one to the bare address rather than to ?page=1", () => {
    expect(pagerMarkup(2, 20, 45, href)).toContain('href="/u/sergiu"');
  });
});
