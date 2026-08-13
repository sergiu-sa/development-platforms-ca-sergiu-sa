// @vitest-environment happy-dom
// Needed because lib/html.ts escapes through a real element rather than a regex, so even these pure string builders reach for a document.
import { describe, expect, it } from "vitest";
import { makeStory } from "../wire/story.fixture";
import { makeBriefing, makeItem } from "./briefing.fixture";
import { indexMarkup, notFoundMarkup, stageMarkup } from "./view";

describe("stageMarkup", () => {
  it("names position 1 as the lede and leaves the rest numbered", () => {
    const b = makeBriefing();

    expect(stageMarkup(b.items[0], 0)).toContain("the lede");
    expect(stageMarkup(b.items[1], 1)).not.toContain("the lede");
  });

  it("numbers a story by its place in the reading order", () => {
    expect(stageMarkup(makeBriefing().items[1], 1)).toContain("02");
  });

  it("gives a live blog the word Live and no reading time", () => {
    const item = makeItem({
      story: makeStory({ tone: "minutebyminute", wordCount: 3112 }),
    });
    const html = stageMarkup(item, 0);

    // A live blog's wordcount is only what has been posted so far, so a reading time would be a lie that grows all afternoon.
    expect(html).toContain("Live");
    expect(html).not.toContain("min read");
  });

  it("gives an ordinary story its reading time", () => {
    const item = makeItem({ story: makeStory({ wordCount: 460 }) });

    expect(stageMarkup(item, 0)).toContain("2 min read");
  });

  it("escapes a note that tries to break out of the document", () => {
    const item = makeItem({
      note: '</p><img src=x onerror="alert(1)">',
    });
    const html = stageMarkup(item, 0);

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;");
  });

  it("renders no image when the story's image is not really http(s)", () => {
    const item = makeItem({
      story: makeStory({
        imageUrl: "javascript:alert(1)",
        thumbnailUrl: null,
      }),
    });

    expect(stageMarkup(item, 0)).not.toContain("javascript:");
  });

  it("falls back to the thumbnail when there is no wide image", () => {
    const item = makeItem({
      story: makeStory({
        imageUrl: null,
        thumbnailUrl: "https://media.guim.co.uk/abc/500.jpg",
      }),
    });

    expect(stageMarkup(item, 0)).toContain("/500.jpg");
  });

  it("omits the note entirely when the curator wrote none", () => {
    const html = stageMarkup(makeItem({ note: null }), 0);

    expect(html).not.toContain("briefing-note");
  });

  it("links out to the Guardian", () => {
    const html = stageMarkup(makeBriefing().items[0], 0);

    expect(html).toContain("https://www.theguardian.com/story-1");
    expect(html).toContain("briefing-read");
  });

  it("escapes the headline inside the read link's spoken label", () => {
    // A Guardian headline can hold real markup: plainText strips tags before it decodes entities, so an encoded <a> arrives in the column as a live one.
    // Unescaped here it put an attacker-authored link inside the briefing body.
    const item = makeItem({
      story: makeStory({
        title: 'Storm hits </a><a href="https://evil.example">Sign in</a>',
      }),
    });

    const html = stageMarkup(item, 0);

    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;");
  });
});

describe("indexMarkup", () => {
  it("marks exactly one entry as current", () => {
    const html = indexMarkup(makeBriefing(), 2);

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("marks the entry the reader is actually on", () => {
    const html = indexMarkup(makeBriefing(), 1);

    // The marked button carries the second story's data-go.
    expect(html).toMatch(/data-go="1"[^>]*aria-current="true"/);
  });

  it("gives index thumbnails an empty alt, because the headline is the label", () => {
    expect(indexMarkup(makeBriefing(), 0)).toContain('alt=""');
  });

  it("escapes a briefing title", () => {
    const html = indexMarkup(
      makeBriefing({ title: "<script>alert(1)</script>" }),
      0
    );

    expect(html).not.toContain("<script>");
  });

  it("omits the intro when there is none rather than leaving an empty line", () => {
    const html = indexMarkup(makeBriefing({ intro: null }), 0);

    expect(html).not.toContain("briefing-intro");
  });

  it("sums reading time across the briefing, skipping live blogs", () => {
    const b = makeBriefing({
      items: [
        makeItem({ position: 1, story: makeStory({ wordCount: 460 }) }),
        makeItem({
          position: 2,
          story: makeStory({ tone: "minutebyminute", wordCount: 3112 }),
        }),
      ],
    });

    // 460 words is 2 minutes; the live blog contributes nothing.
    expect(indexMarkup(b, 0)).toContain("2 min read");
  });
});

describe("notFoundMarkup", () => {
  const HERE = "/b/some-slug-7f3a";

  it("offers sign-in only when a token is stored", () => {
    expect(notFoundMarkup(true, HERE)).toContain("Sign in");
    expect(notFoundMarkup(false, HERE)).not.toContain("Sign in");
  });

  it("carries the reader back to this briefing after signing in", () => {
    expect(notFoundMarkup(true, HERE)).toContain(encodeURIComponent(HERE));
  });

  it("says the same thing about a draft as about an address that never existed", () => {
    expect(notFoundMarkup(false, HERE)).toContain("does not exist");
  });
});
