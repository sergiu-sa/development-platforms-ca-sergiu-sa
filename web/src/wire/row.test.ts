// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderRow } from "./row";
import { makeStory } from "./story.fixture";
import type { Decision, Story } from "./types";

const NOW = new Date("2026-08-01T15:00:00.000Z");

/** Parses the row so assertions run against the DOM, not a string. */
function row(
  over: Partial<Story> = {},
  state: { decision?: Decision | null; onDeck?: boolean } = {}
): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderRow(
    makeStory(over),
    { decision: state.decision ?? null, onDeck: state.onDeck ?? false },
    NOW
  );
  return host.firstElementChild as HTMLElement;
}

const text = (el: HTMLElement, selector: string) =>
  el.querySelector(selector)?.textContent?.trim();

/**
 * The action labels a sighted reader sees, with the screen-reader-only tails
 * and the decorative arrow taken out - those are deliberate, and counting them
 * here would make this a test of the wrong thing.
 */
const actionLabels = (el: HTMLElement) =>
  [...el.querySelectorAll(".row-acts button, .row-acts a")].map((node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll(
      '.sr-only, [aria-hidden="true"]'
    )) {
      hidden.remove();
    }
    return copy.textContent?.replace(/\s+/g, " ").trim();
  });

describe("the row's identity", () => {
  it("carries the story id, so a click can find it again", () => {
    expect(row({ id: 42 }).dataset.storyId).toBe("42");
  });

  it("carries the decision as an attribute and as a word", () => {
    // Colour is never the only signal: the blue edge comes from the attribute,
    // and the word is there for anyone the colour does not reach.
    const saved = row({}, { decision: "saved" });

    expect(saved.dataset.state).toBe("saved");
    expect(text(saved, ".row-state")).toBe("Saved");
  });

  it("has no state attribute when nothing has been decided", () => {
    expect(row().dataset.state).toBeUndefined();
  });

  it("says which story the deck is holding", () => {
    expect(text(row({}, { onDeck: true }), ".row-state")).toBe("On deck");
    expect(text(row(), ".row-state")).toBe("Not seen");
  });

  it("prefers the decision over the deck's position", () => {
    // A story can be on deck and decided at once for one render, between a
    // decision landing and the cursor moving on.
    expect(
      text(row({}, { decision: "skipped", onDeck: true }), ".row-state")
    ).toBe("Skipped");
  });
});

describe("the row's picture", () => {
  it("offers both widths so the browser can pick", () => {
    const img = row().querySelector("img")!;

    expect(img.getAttribute("srcset")).toBe(
      "https://media.guim.co.uk/abc/500.jpg 500w, https://media.guim.co.uk/abc/1000.jpg 1000w"
    );
    expect(img.getAttribute("src")).toBe(
      "https://media.guim.co.uk/abc/500.jpg"
    );
  });

  it("is lazy, because most rows are below the fold", () => {
    expect(row().querySelector("img")?.getAttribute("loading")).toBe("lazy");
  });

  it("falls back to the thumbnail for the rows stored before phase 1", () => {
    // 327 of them have no 1000px image and never self-correct, because only
    // the newest 50 stories are ever refreshed.
    const img = row({ imageUrl: null }).querySelector("img")!;

    expect(img.getAttribute("src")).toBe(
      "https://media.guim.co.uk/abc/500.jpg"
    );
    expect(img.getAttribute("srcset")).toBeNull();
  });

  it("uses the wide image alone when there is no thumbnail", () => {
    const img = row({ thumbnailUrl: null }).querySelector("img")!;

    expect(img.getAttribute("src")).toBe(
      "https://media.guim.co.uk/abc/1000.jpg"
    );
    expect(img.getAttribute("srcset")).toBeNull();
  });

  it("draws no picture at all rather than a broken one", () => {
    expect(
      row({ imageUrl: null, thumbnailUrl: null }).querySelector("img")
    ).toBeNull();
  });

  it("takes real alt text from the API, and empty alt when there is none", () => {
    expect(row().querySelector("img")?.getAttribute("alt")).toBe(
      "Two riders neck and neck at full gallop"
    );
    expect(
      row({ imageAlt: null }).querySelector("img")?.getAttribute("alt")
    ).toBe("");
  });

  it("renders no picture for a source that is not really a URL", () => {
    // The wire is third-party content and an image source is a fetch.
    expect(
      row({
        imageUrl: "javascript:alert(1)",
        thumbnailUrl: null,
      }).querySelector("img")
    ).toBeNull();
  });
});

describe("the row's facts", () => {
  it("gives a live blog the dot and the word, and no reading time", () => {
    // A live blog's wordcount is only what has been posted so far, so a fixed
    // "14 min read" would be a lie that grows all afternoon.
    const live = row({ tone: "minutebyminute" });

    expect(text(live, ".live")).toBe("Live");
    expect(live.textContent).not.toContain("min read");
  });

  it("gives an ordinary story its reading time", () => {
    expect(row().textContent).toContain("2 min read");
  });

  it("draws a review's rating with a text equivalent", () => {
    const review = row({ tone: "reviews", starRating: 0 });

    // Zero is a real verdict, not a missing one.
    expect(review.querySelector(".stars")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    expect(review.textContent).toContain("Rated 0 out of 5");
  });

  it("prints By only when the Guardian has not", () => {
    expect(row({ byline: "Kirsty Byrne" }).textContent).toContain(
      "By Kirsty Byrne"
    );
    expect(row({ byline: "Exclusive by Nick Ames" }).textContent).not.toContain(
      "By Exclusive by"
    );
  });

  it("shows the pillar and the section", () => {
    const facts = row({ pillar: "Sport", section: "Football" }).textContent!;
    expect(facts).toContain("Sport");
    expect(facts).toContain("Football");
  });
});

describe("the row's actions", () => {
  it("offers Save and Skip on a story with no decision", () => {
    expect(actionLabels(row())).toEqual(["Save", "Skip", "Read"]);
  });

  it("offers Remove instead of Save once a story is saved", () => {
    expect(actionLabels(row({}, { decision: "saved" }))).toEqual([
      "Remove",
      "Skip",
      "Read",
    ]);
  });

  it("offers Un-skip instead of Skip once a story is skipped", () => {
    expect(actionLabels(row({}, { decision: "skipped" }))).toEqual([
      "Save",
      "Un-skip",
      "Read",
    ]);
  });

  it("links Read to the story, opening in a new tab", () => {
    const link = row().querySelector<HTMLAnchorElement>(".row-acts a")!;

    expect(link.getAttribute("href")).toBe(
      "https://www.theguardian.com/story-1"
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("opens in a new tab");
  });

  it("renders no Read link for a url that is not http", () => {
    // A javascript: href is script execution, and the wire is somebody else's.
    expect(
      row({ url: "javascript:alert(1)" }).querySelector(".row-acts a")
    ).toBeNull();
  });

  it("leaves the headline as text, so the row has one link and three actions", () => {
    const el = row();
    expect(el.querySelector(".row-h a")).toBeNull();
    expect(el.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("the row's escaping", () => {
  it("escapes every field that reaches the markup", () => {
    const el = row({
      title: '<img src=x onerror="alert(1)">',
      summary: "<script>alert(2)</script>",
      byline: '"><script>alert(3)</script>',
      section: "<b>Sport</b>",
      pillar: "<b>News</b>",
      imageAlt: '"><script>alert(4)</script>',
    });

    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector(".row-h img")).toBeNull();
    expect(text(el, ".row-h")).toBe('<img src=x onerror="alert(1)">');
    expect(el.querySelector("img")?.getAttribute("alt")).toBe(
      '"><script>alert(4)</script>'
    );
  });
});
