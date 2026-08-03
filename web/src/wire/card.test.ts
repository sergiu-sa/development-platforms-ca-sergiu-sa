// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { cardVariant, renderCard } from "./card";
import { makeStory } from "./story.fixture";
import type { Story } from "./types";

const NOW = new Date("2026-08-01T15:00:00.000Z");

/** Parses the card so assertions run against the DOM, not a string. */
function card(over: Partial<Story> = {}): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderCard(makeStory(over), NOW);
  return host.firstElementChild as HTMLElement;
}

describe("cardVariant", () => {
  it("maps each tone the Guardian sends", () => {
    expect(cardVariant("minutebyminute", null)).toBe("live");
    expect(cardVariant("comment", null)).toBe("opinion");
    expect(cardVariant("features", null)).toBe("feature");
    expect(cardVariant("reviews", 4)).toBe("review");
    expect(cardVariant("news", null)).toBe("news");
  });

  it("draws a review without a rating as an ordinary story", () => {
    // The rating is the whole variant. Reviews do not always carry one.
    expect(cardVariant("reviews", null)).toBe("news");
  });

  it("keeps a zero-star review a review", () => {
    // Guardian ratings run 0 to 5 and the backend stores a zero, so a
    // truthiness check would throw away the harshest verdict there is.
    expect(cardVariant("reviews", 0)).toBe("review");
  });

  it("falls back to news for a tone it has never heard of", () => {
    expect(cardVariant("interview", null)).toBe("news");
    expect(cardVariant("", null)).toBe("news");
  });
});

describe("the live variant", () => {
  it("carries the word as well as the dot", () => {
    const live = card({ tone: "minutebyminute" });

    expect(live.dataset.variant).toBe("live");
    expect(live.querySelector(".live")?.textContent).toBe("Live");
  });

  it("shows no reading time", () => {
    // A live blog's word count is only what has been posted so far.
    const live = card({ tone: "minutebyminute", wordCount: 2344 });
    expect(live.textContent).not.toContain("min read");
  });

  it("is chosen by the tag, never by the headline", () => {
    const fake = card({ tone: "news", title: "Everything, everywhere - live" });

    expect(fake.dataset.variant).toBe("news");
    expect(fake.querySelector(".live")).toBeNull();
  });
});

describe("the opinion variant", () => {
  it("leads with the writer and drops the byline line", () => {
    const opinion = card({ tone: "comment", byline: "Arwa Mahdawi" });

    expect(opinion.querySelector(".writer")?.textContent).toBe("Arwa Mahdawi");
    expect(opinion.querySelector(".byline")).toBeNull();
  });

  it("still renders without a byline", () => {
    const opinion = card({ tone: "comment", byline: null });

    expect(opinion.querySelector(".writer")).toBeNull();
    expect(opinion.querySelector(".headline")).not.toBeNull();
  });
});

describe("the review variant", () => {
  it("fills the squares to the rating and gives the number as text", () => {
    const review = card({ tone: "reviews", starRating: 4 });

    expect(review.querySelectorAll(".stars i").length).toBe(5);
    expect(review.querySelectorAll(".stars i.on").length).toBe(4);
    expect(review.querySelector(".stars")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    expect(review.querySelector(".sr-only")?.textContent).toBe(
      "Rated 4 out of 5"
    );
  });

  it("does not crash when the rating is missing", () => {
    const review = card({ tone: "reviews", starRating: null });

    expect(review.dataset.variant).toBe("news");
    expect(review.querySelector(".stars")).toBeNull();
  });

  it("renders a zero-star rating rather than dropping it", () => {
    const panned = card({ tone: "reviews", starRating: 0 });

    expect(panned.dataset.variant).toBe("review");
    expect(panned.querySelectorAll(".stars i").length).toBe(5);
    expect(panned.querySelectorAll(".stars i.on").length).toBe(0);
    expect(panned.querySelector(".sr-only")?.textContent).toBe(
      "Rated 0 out of 5"
    );
  });
});

describe("the other variants", () => {
  it("names the byline on anything that is not a comment piece", () => {
    const feature = card({ tone: "features", byline: "Lanre Bakare" });

    expect(feature.dataset.variant).toBe("feature");
    expect(feature.querySelector(".byline")?.textContent).toContain(
      "Lanre Bakare"
    );
    expect(feature.querySelector(".writer")).toBeNull();
  });

  it("shows a reading time rounded to the minute", () => {
    expect(card({ wordCount: 460 }).textContent).toContain("2 min read");
  });

  it("does not print a second By when the Guardian supplied one", () => {
    // Real value off the wire: "Exclusive by Nick Ames and Matt Hughes".
    const exclusive = card({
      byline: "Exclusive by Nick Ames and Matt Hughes",
    });

    expect(exclusive.querySelector(".byline")?.textContent).toBe(
      "Exclusive by Nick Ames and Matt Hughes"
    );
  });

  it("still labels an ordinary byline", () => {
    expect(
      card({ byline: "Sam Jones in Madrid" }).querySelector(".byline")
        ?.textContent
    ).toBe("By Sam Jones in Madrid");
  });

  it("is not fooled by a name that merely contains those letters", () => {
    expect(
      card({ byline: "Kirsty Byrne" }).querySelector(".byline")?.textContent
    ).toBe("By Kirsty Byrne");
  });
});

describe("the photograph", () => {
  it("prefers the 1000px asset", () => {
    const img = card().querySelector("img");
    expect(img?.getAttribute("src")).toContain("1000.jpg");
  });

  it("falls back to the thumbnail for a story stored before phase 1", () => {
    const img = card({ imageUrl: null }).querySelector("img");
    expect(img?.getAttribute("src")).toContain("500.jpg");
  });

  it("renders no figure at all when there is no image", () => {
    const bare = card({ imageUrl: null, thumbnailUrl: null });

    expect(bare.querySelector("figure")).toBeNull();
    expect(bare.dataset.shot).toBe("none");
    expect(bare.querySelector(".headline")).not.toBeNull();
  });

  it("uses the API's alt text", () => {
    const img = card({ imageAlt: "A carrot grower in a field" }).querySelector(
      "img"
    );
    expect(img?.getAttribute("alt")).toBe("A carrot grower in a field");
  });

  it("marks an image with no alt text as decorative rather than inventing one", () => {
    const img = card({ imageAlt: null }).querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("omits the credit when there is none", () => {
    expect(card({ imageCredit: null }).querySelector("figcaption")).toBeNull();
  });

  it("refuses an image source that is not http(s)", () => {
    // Escaping stops an attribute breaking out; it says nothing about the
    // scheme, and the wire is third-party content.
    const nasty = card({
      imageUrl: "javascript:alert(1)",
      thumbnailUrl: null,
    });

    expect(nasty.querySelector("img")).toBeNull();
    expect(nasty.dataset.shot).toBe("none");
  });

  it("falls back past an unsafe 1000px asset to a safe thumbnail", () => {
    const img = card({
      imageUrl: "javascript:alert(1)",
      thumbnailUrl: "https://media.guim.co.uk/abc/500.jpg",
    }).querySelector("img");

    expect(img?.getAttribute("src")).toBe(
      "https://media.guim.co.uk/abc/500.jpg"
    );
  });
});

describe("the source link", () => {
  it("opens the Guardian in a new tab and says so", () => {
    const link = card().querySelector("a.src");

    expect(link?.getAttribute("href")).toBe(
      "https://www.theguardian.com/story-1"
    );
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toContain("opens in a new tab");
  });

  it("renders no link at all for a url that is not http(s)", () => {
    // The wire is third-party content and a javascript: href is execution.
    const nasty = card({ url: "javascript:alert(1)" });
    expect(nasty.querySelector("a.src")).toBeNull();
  });
});

describe("escaping", () => {
  const payload = '"><img src=x onerror="alert(1)">';

  it("escapes every field that comes off the wire", () => {
    const nasty = card({
      title: payload,
      standfirst: payload,
      byline: payload,
      section: payload,
      pillar: payload,
      imageAlt: payload,
      imageCredit: payload,
    });

    expect(nasty.querySelector("img[onerror]")).toBeNull();
    expect(nasty.querySelectorAll("img").length).toBe(1); // the photograph
    expect(nasty.querySelector(".headline")?.textContent).toBe(payload);
  });

  it("escapes quotes inside attributes", () => {
    // The alt lands inside an attribute, where an unescaped quote breaks out.
    const nasty = card({ imageAlt: '" onerror="alert(1)' });
    const img = nasty.querySelector("img");

    expect(img?.getAttribute("onerror")).toBeNull();
    expect(img?.getAttribute("alt")).toBe('" onerror="alert(1)');
  });

  it("escapes a headline in the comment variant's writer slot too", () => {
    const nasty = card({ tone: "comment", byline: payload });

    expect(nasty.querySelector("img[onerror]")).toBeNull();
    expect(nasty.querySelector(".writer")?.textContent).toBe(payload);
  });
});

describe("structure", () => {
  it("uses h2 so the page keeps one stable h1", () => {
    // The card changes on every keypress; a changing h1 is a moving target.
    expect(card().querySelector(".headline")?.tagName).toBe("H2");
  });

  it("prints the slug and the pillar", () => {
    // Different section and pillar, so one cannot stand in for the other.
    const meta = card({ section: "Football", id: 1053, pillar: "Sport" });
    const slugline = meta.querySelector(".slugline");

    expect(slugline?.querySelector(".slugline-id")?.textContent).toBe(
      "FOOTBALL-1053"
    );
    // Asserting only the slug left the pillar free to be deleted silently.
    expect(slugline?.querySelector(".quiet")?.textContent).toBe("Sport");
  });

  it("gives the timestamp a machine-readable datetime", () => {
    const time = card().querySelector("time");

    expect(time?.getAttribute("datetime")).toBe("2026-08-01T13:00:00.000Z");
    expect(time?.textContent).toBe("2h ago");
  });
});
