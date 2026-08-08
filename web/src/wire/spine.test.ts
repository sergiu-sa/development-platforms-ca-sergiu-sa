// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore, type DeckStore } from "./store";
import { makeStories } from "./story.fixture";
import { mountSpine, showDeskLink } from "./spine";

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
      <a class="btn m" id="spine-desk" href="/desk.html" hidden>My desk</a>
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
  window.localStorage.clear();
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
    // The CSS `scroll-behavior: auto` in the reduced-motion block does not reach this:
    // an explicit `behavior` passed to scrollTo wins over the computed property, so the option has to be decided in JS.
    prefersReducedMotion(true);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    mountPage();

    document.getElementById("spine-deck")!.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});

describe("the spine's desk link", () => {
  it("stays hidden from a signed-out reader, who has no desk", () => {
    mountPage();
    showDeskLink();

    expect(document.getElementById("spine-desk")?.hidden).toBe(true);
  });

  it("appears for a signed-in reader", () => {
    // The link §6.3 asked for from the start. Phase 4 left it out because /desk did not exist; phase 7 built it.
    window.localStorage.setItem("token", "a.b.c");
    mountPage();
    showDeskLink();

    const desk = document.getElementById("spine-desk");

    expect(desk?.hidden).toBe(false);
    expect(desk?.getAttribute("href")).toBe("/desk.html");
  });

  // It is revealed before the wire is fetched, and deliberately not by mountSpine:
  // a failed wire returns early, and that is the one moment the desk is the only page still worth anything.
  it("does not depend on the wire having loaded", () => {
    window.localStorage.setItem("token", "a.b.c");
    document.body.innerHTML = `
      <header class="spine" id="spine">
        <a class="btn m" id="spine-desk" href="/desk.html" hidden>My desk</a>
      </header>
    `;

    showDeskLink();

    expect(document.getElementById("spine-desk")?.hidden).toBe(false);
  });
});
