// @vitest-environment happy-dom
// escapeHtml round-trips through a real element, so these need a document even
// though nothing here renders one.
import { describe, it, expect } from "vitest";
import { makeStory } from "../wire/story.fixture";
import { addMarkup, bandMarkup, barMarkup, mastheadMarkup } from "./view";
// Imported from where it lives rather than through the builder, so the test is about the shared function rather than about a re-export agreeing with it.
import { positionLabel } from "../briefing/state";
import type { BuilderItem, BuilderState } from "./state";

const NOW = new Date("2026-08-16T12:00:00Z");

function makeItem(id: number, over: Partial<BuilderItem> = {}): BuilderItem {
  return {
    id,
    storyId: id * 100,
    note: "A note",
    story: makeStory({ id: id * 100, publishedAt: "2026-08-16T11:00:00Z" }),
    ...over,
  };
}

function makeState(over: Partial<BuilderState> = {}): BuilderState {
  return {
    id: 7,
    slug: "the-heat-7f3a",
    title: "The heat, and who pays for it",
    intro: "How it starts.",
    status: "draft",
    items: [makeItem(1), makeItem(2), makeItem(3)],
    ...over,
  };
}

describe("a band", () => {
  it("marks only the first story as the lede", () => {
    const items = [makeItem(1), makeItem(2)];

    expect(bandMarkup(items[0], 0, 2, NOW)).toContain("the lede");
    expect(bandMarkup(items[1], 1, 2, NOW)).not.toContain("the lede");
  });

  it("cannot move the first story up or the last one down", () => {
    const first = bandMarkup(makeItem(1), 0, 2, NOW);
    const last = bandMarkup(makeItem(2), 1, 2, NOW);

    expect(first).toContain('data-move="up" data-item="1" disabled');
    expect(first).not.toContain('data-move="down" data-item="1" disabled');
    expect(last).toContain('data-move="down" data-item="2" disabled');
  });

  // Five buttons all reading "Move up" are indistinguishable to anyone listening.
  // The headline extends the visible label rather than replacing it, which an aria-label would have done.
  it("names the story on every control without hiding the visible word", () => {
    const markup = bandMarkup(
      makeItem(1, { story: makeStory({ id: 1, title: "Carrots in crisis" }) }),
      0,
      2,
      NOW
    );

    expect(markup).toContain(
      '>Move up<span class="sr-only"> - Carrots in crisis</span>'
    );
    expect(markup).toContain(
      '>Remove<span class="sr-only"> - Carrots in crisis</span>'
    );
  });

  it("gives the note field a label naming the story it is about", () => {
    const markup = bandMarkup(
      makeItem(4, { story: makeStory({ id: 4, title: "Carrots in crisis" }) }),
      0,
      1,
      NOW
    );

    expect(markup).toContain('for="note-4"');
    expect(markup).toContain("Your note on Carrots in crisis");
  });

  // A note is prose somebody typed, and `</textarea>` in it would close the
  // field and put the rest of the note into the document as markup.
  it("cannot be broken out of by what somebody types into it", () => {
    const markup = bandMarkup(
      makeItem(1, { note: "</textarea><script>alert(1)</script>" }),
      0,
      1,
      NOW
    );

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;/textarea&gt;");
  });

  // The wire is somebody else's, and plainText strips tags before it decodes entities, so an encoded tag can reach stories.title intact.
  it("escapes a headline carrying markup", () => {
    const markup = bandMarkup(
      makeItem(1, {
        story: makeStory({ id: 1, title: '</a><a href="x">Sign in</a>' }),
      }),
      0,
      1,
      NOW
    );

    expect(markup).not.toContain('<a href="x">');
  });

  it("draws no image element for a story that has none", () => {
    const markup = bandMarkup(
      makeItem(1, {
        story: makeStory({ id: 1, imageUrl: null, thumbnailUrl: null }),
      }),
      0,
      1,
      NOW
    );

    expect(markup).not.toContain("<img");
  });

  it("refuses an image url that is not really a url", () => {
    const markup = bandMarkup(
      makeItem(1, {
        story: makeStory({
          id: 1,
          imageUrl: "javascript:alert(1)",
          thumbnailUrl: null,
        }),
      }),
      0,
      1,
      NOW
    );

    expect(markup).not.toContain("javascript:");
  });
});

describe("the masthead", () => {
  it("says whether the briefing is a draft or filed", () => {
    expect(mastheadMarkup(makeState())).toContain(">Draft<");
    expect(mastheadMarkup(makeState({ status: "published" }))).toContain(
      ">Filed<"
    );
  });

  it("counts one story without an s", () => {
    expect(mastheadMarkup(makeState({ items: [makeItem(1)] }))).toContain(
      "1 story<"
    );
    expect(mastheadMarkup(makeState())).toContain("3 stories<");
  });

  // The one thing the galley cannot show at a glance once the page is longer than the screen, and noise on a finished briefing, so it appears only when there is something to say.
  it("counts the stories with no note, and stays silent when there are none", () => {
    const some = makeState({
      items: [makeItem(1, { note: "" }), makeItem(2, { note: "   " })],
    });

    expect(mastheadMarkup(some)).toContain("2 without a note");
    expect(mastheadMarkup(makeState())).not.toContain("without a note");
  });

  // The briefing's own title is a field being edited here rather than a heading, so the page would have no h1 at all and open its outline at h2.
  it("opens the heading outline with an h1", () => {
    expect(mastheadMarkup(makeState())).toContain("<h1");
    expect(bandMarkup(makeItem(1), 0, 1, NOW)).toContain("<h2");
  });

  // The page repaints this paragraph on its own while somebody types, because writing a note moves the count and redrawing the masthead would take the caret with it.
  // The id is the contract between the two.
  it("gives the facts line an id the page can repaint on its own", () => {
    expect(mastheadMarkup(makeState())).toContain('id="build-facts"');
  });

  it("escapes a title somebody typed markup into", () => {
    const markup = mastheadMarkup(
      makeState({ title: "</textarea><img src=x onerror=alert(1)>" })
    );

    expect(markup).not.toContain("<img");
  });
});

describe("the bar", () => {
  // Never disabled: a greyed-out control makes the curator guess which rule they broke, and WCAG exempts a disabled control from contrast, so the explanation would be the dimmest thing on the bar.
  it("keeps File pressable and says what is missing beside it", () => {
    const markup = barMarkup(makeState({ title: "", items: [] }), "saved");

    expect(markup).toContain("data-file");
    expect(markup).not.toContain("disabled");
    expect(markup).toContain("Needs a title and one story");
  });

  it("says nothing extra when it can be filed", () => {
    expect(barMarkup(makeState(), "saved")).not.toContain("Needs");
  });

  it("offers the way to read it, and back to a draft, once it is filed", () => {
    const markup = barMarkup(makeState({ status: "published" }), "saved");

    expect(markup).toContain('href="/b/the-heat-7f3a"');
    expect(markup).toContain("data-withdraw");
    expect(markup).not.toContain("data-file");
  });

  // The save state changes with nobody having navigated or clicked, so it has to announce itself, and politely enough not to interrupt typing.
  it("announces the save state", () => {
    expect(barMarkup(makeState(), "saved")).toContain('aria-live="polite"');
  });
});

describe("adding stories", () => {
  it("offers the way in while there is room", () => {
    expect(addMarkup(12)).toContain("data-add");
  });

  it("says it is full rather than offering a control that cannot work", () => {
    const markup = addMarkup(0);

    expect(markup).not.toContain("data-add");
    expect(markup).toContain("full");
  });
});

describe("positions", () => {
  it("pads to two digits, matching the reading view", () => {
    expect(positionLabel(0)).toBe("01");
    expect(positionLabel(11)).toBe("12");
  });
});
