// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore, type DeckStore } from "./store";
import { makeStories } from "./story.fixture";
import { mountSpine } from "./spine";

/** Answers the reduced-motion query with `reduce`, and nothing else. */
function prefersReducedMotion(reduce: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList
  );
}

function mountPage(): DeckStore {
  document.body.innerHTML = `
    <header class="spine" id="spine">
      <span class="m quiet" id="spine-count"></span>
      <button class="btn m" id="spine-deck" type="button"></button>
    </header>
  `;

  const store = createStore(makeStories(6));
  mountSpine(store);
  return store;
}

const counts = () => document.getElementById("spine-count")?.textContent;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the spine", () => {
  it("keeps the saved count on screen once the deck is behind you", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.decide(2, "skipped");

    expect(counts()).toBe("6 on the wire · 1 saved · 1 skipped");
  });

  it("starts at nothing decided", () => {
    mountPage();
    expect(counts()).toBe("6 on the wire · 0 saved · 0 skipped");
  });

  it("follows a decision taken back", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.clear(1);

    expect(counts()).toBe("6 on the wire · 0 saved · 0 skipped");
  });

  it("labels the way back to the deck", () => {
    mountPage();
    const back = document.getElementById("spine-deck")!;

    expect(back.getAttribute("aria-label")).toBe("Back to the deck");
    expect(back.textContent).toContain("Back to the deck");
  });
});

describe("going back to the deck", () => {
  it("eases the jump by default", () => {
    prefersReducedMotion(false);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    mountPage();

    document.getElementById("spine-deck")!.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("jumps instantly when the reader asks for reduced motion", () => {
    // The CSS `scroll-behavior: auto` in the reduced-motion block does not
    // reach this: an explicit `behavior` passed to scrollTo wins over the
    // computed property, so the option has to be decided in JS.
    prefersReducedMotion(true);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    mountPage();

    document.getElementById("spine-deck")!.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
