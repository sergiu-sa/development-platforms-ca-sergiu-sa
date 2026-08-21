/**
 * The document parts both generated pages share.
 *
 * These moved out of `briefing-page.shell.ts` in phase 11, at their second use, and the escapers are the reason it was worth doing rather than copying:
 * a copied escaper is a fix that only ever fixes one of the two pages, and both of them interpolate somebody's free text into markup.
 *
 * No database and no Hono here. Every case is a pure function.
 */

import { describe, expect, it } from "vitest";
import {
  attr,
  buildDocument,
  fallbackHead,
  inlineJson,
  metaTag,
  nameTag,
  truncateWords,
} from "../src/html/page-shell.js";

describe("attr", () => {
  it("closes the quote that would otherwise break out of an attribute", () => {
    // The case it exists for: a title carrying a double quote ends the value early and turns the rest into markup.
    expect(attr('He said "no"')).toBe("He said &quot;no&quot;");
  });

  it("escapes the angle brackets that would open a tag", () => {
    expect(attr("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes the ampersand first, so an escape cannot be double-escaped", () => {
    // & before < matters: the other way round, "<" becomes "&lt;" and then its own ampersand is escaped again into "&amp;lt;".
    expect(attr("a & b < c")).toBe("a &amp; b &lt; c");
  });
});

describe("inlineJson", () => {
  it("stops a value closing the script element it sits in", () => {
    const payload = inlineJson({ note: "</script><script>alert(1)</script>" });

    expect(payload).not.toContain("</script>");
    expect(payload).toContain("\\u003c");
  });

  it("round-trips through JSON.parse unchanged", () => {
    // The escape has to be one JSON reads straight back, or the client receives something the server did not hold.
    const value = { title: 'Quotes "and" <angles> & more' };

    expect(JSON.parse(inlineJson(value))).toEqual(value);
  });
});

describe("truncateWords", () => {
  it("leaves anything inside the limit alone", () => {
    expect(truncateWords("Short enough.", 200)).toBe("Short enough.");
  });

  it("cuts on a word boundary rather than mid-word", () => {
    const cut = truncateWords("one two three four five", 12);

    expect(cut).toBe("one two...");
  });

  it("gives the empty string for null, not the word null", () => {
    expect(truncateWords(null, 200)).toBe("");
  });

  it("cuts hard when there is no space to cut at", () => {
    // A single very long token still has to be bounded, or the limit means nothing.
    expect(truncateWords("a".repeat(50), 10)).toBe(`${"a".repeat(10)}...`);
  });
});

describe("metaTag and nameTag", () => {
  it("escape their content", () => {
    expect(metaTag("og:title", 'A "title"')).toBe(
      '<meta property="og:title" content="A &quot;title&quot;" />'
    );
    expect(nameTag("description", "a & b")).toBe(
      '<meta name="description" content="a &amp; b" />'
    );
  });
});

describe("fallbackHead", () => {
  it("carries noindex, because there is nothing here worth a search result", () => {
    expect(fallbackHead("Briefing - Lede")).toContain(
      '<meta name="robots" content="noindex" />'
    );
  });

  it("says what the site is, so a pasted link still previews as something", () => {
    const head = fallbackHead("Curator - Lede");

    expect(head).toContain('content="Lede"');
    expect(head).toContain("A live news wire");
  });
});

describe("buildDocument", () => {
  const base = { head: "<title>T</title>", script: "/assets/x.js" };

  it("names the stylesheet the build pins", () => {
    const html = buildDocument({ ...base, loading: "Loading..." });

    expect(html).toContain('<link rel="stylesheet" href="/assets/lede.css" />');
  });

  it("inlines a payload under the id it was given", () => {
    const html = buildDocument({
      ...base,
      loading: "Loading...",
      data: { id: "curator-data", value: { username: "sergiu" } },
    });

    const payload = /id="curator-data">([\s\S]*?)<\/script>/.exec(html);

    expect(payload).not.toBeNull();
    expect(JSON.parse(payload![1])).toEqual({ username: "sergiu" });
  });

  it("inlines nothing at all when there is nothing to inline", () => {
    const html = buildDocument({ ...base, loading: "Loading...", data: null });

    expect(html).not.toContain('type="application/json"');
    // Only the page's own module, so a document describing nothing carries no clue about why.
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it("escapes the loading line, so a future dynamic one cannot open a hole", () => {
    // Always a literal today. The escape is what stops that being a rule somebody has to remember.
    const html = buildDocument({ ...base, loading: "<b>Loading</b>" });

    expect(html).toContain("&lt;b&gt;Loading&lt;/b&gt;");
    expect(html).not.toContain("<b>Loading</b>");
  });
});
