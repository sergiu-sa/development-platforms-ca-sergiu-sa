// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountDeck } from "./deck-view";
import { decisionFor } from "./deck";
import { createStore } from "./store";
import { makeStories } from "./story.fixture";

/**
 * Captures the IntersectionObserver the deck sets up, so a test can say the
 * deck has scrolled out of view. happy-dom has no layout, so there is no
 * honest way to do this other than driving the observer directly.
 */
let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

function stubIntersectionObserver(): void {
  observed = null;
  class FakeObserver {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      observed = callback;
    }
    observe() {}
  }

  Object.defineProperty(window, "IntersectionObserver", {
    value: FakeObserver,
    writable: true,
    configurable: true,
  });
}

const scrollDeckAway = () => observed?.([{ isIntersecting: false }]);
const scrollDeckBack = () => observed?.([{ isIntersecting: true }]);

/**
 * The deck's markup, reduced to the ids `mountDeck` reaches for.
 *
 * Written out rather than imported from `index.html` on purpose: a test that
 * reads the real page would go green the moment someone deleted an element
 * from it, which is the opposite of what it is for.
 */
function mountPage(storyCount: number) {
  document.body.innerHTML = `
    <section class="deck" id="deck"></section>
    <div class="card-wrap" id="deck-slot"></div>
    <div class="acts" id="deck-acts" hidden>
      <button id="deck-skip" type="button"></button>
      <a id="deck-browse" href="#browse"><span id="browse-count">0</span></a>
      <button id="deck-save" type="button"></button>
    </div>
    <p class="gauge"><span id="deck-position"></span>
      <span id="gauge-bar"></span></p>
    <aside><span id="rail-skip-n"></span><div id="rail-skip-slugs"></div></aside>
    <aside><span id="rail-save-n"></span><div id="rail-save-slugs"></div></aside>
  `;

  const store = createStore(makeStories(storyCount));
  mountDeck(store);
  return store;
}

const slot = () => document.getElementById("deck-slot")!;
const onScreen = () => slot().querySelector(".card:not(.leaving)");
const ghosts = () => slot().querySelectorAll(".card.leaving");

const press = (key: string) =>
  document.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    })
  );

/**
 * The deck binds its keys to the document, and `document` outlives
 * `body.innerHTML`. Without this each mount leaves its listener behind, and
 * the first stale one to handle a key calls `preventDefault()` - which the
 * live handler reads as "already dealt with" and ignores. Every key test would
 * then pass or fail for reasons that have nothing to do with the deck.
 */
const bound: Array<[string, EventListener]> = [];
const addEventListener = document.addEventListener.bind(document);

beforeEach(() => {
  window.sessionStorage.clear();
  stubIntersectionObserver();

  document.addEventListener = ((
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ) => {
    bound.push([type, listener]);
    addEventListener(type, listener, options);
  }) as typeof document.addEventListener;
});

afterEach(() => {
  for (const [type, listener] of bound) {
    document.removeEventListener(type, listener);
  }
  bound.length = 0;
});

describe("the deck's fly-out", () => {
  it("plays when the reader decides the card in front of them", () => {
    const store = mountPage(5);
    expect(onScreen()?.querySelector(".headline")?.textContent).toBe("Story 1");

    store.decideCurrent("saved");

    expect(ghosts()).toHaveLength(1);
    expect(onScreen()?.querySelector(".headline")?.textContent).toBe("Story 2");
  });

  it("does not fly the current card away when the list decides another one", () => {
    // Phase 4 gives every row its own Save and Skip, so a decision can land on
    // a story that is nowhere near the deck. The card on screen has not been
    // decided and has not changed, and animating it off would tell the reader
    // it had.
    const store = mountPage(5);

    store.decide(4, "saved");

    expect(ghosts()).toHaveLength(0);
    expect(onScreen()?.querySelector(".headline")?.textContent).toBe("Story 1");
  });

  it("does not fly a card away when a decision is taken back", () => {
    // Remove and Un-skip only ever reach a story that is already decided, so
    // by definition never the undecided one on deck.
    const store = mountPage(5);
    store.decide(4, "saved");

    store.clear(4);

    expect(ghosts()).toHaveLength(0);
    expect(onScreen()?.querySelector(".headline")?.textContent).toBe("Story 1");
  });
});

describe("the deck's keys", () => {
  it("decides the card while the deck is on screen", () => {
    const store = mountPage(5);

    press("s");

    expect(decisionFor(store.get(), 1)).toBe("saved");
  });

  it("stops deciding once the deck has scrolled away", () => {
    // The bindings are on the document, so before this a reader who had
    // scrolled down to read the list would decide the card behind them by
    // pressing S. Nothing becomes unreachable: every row carries its own
    // labelled Save and Skip.
    const store = mountPage(5);
    scrollDeckAway();

    press("s");
    press("x");
    press("ArrowLeft");

    expect(decisionFor(store.get(), 1)).toBeNull();
  });

  it("decides again once the deck is back", () => {
    const store = mountPage(5);
    scrollDeckAway();
    scrollDeckBack();

    press("x");

    expect(decisionFor(store.get(), 1)).toBe("skipped");
  });

  it("still undoes from anywhere on the page", () => {
    // Undo stays global because the toast that offers it is fixed-position,
    // so there is always feedback wherever the reader is standing.
    const store = mountPage(5);
    store.decide(3, "saved");
    scrollDeckAway();

    press("z");

    expect(decisionFor(store.get(), 3)).toBeNull();
  });
});

describe("the deck's rails and gauge", () => {
  it("count a decision made anywhere, not just on the deck", () => {
    const store = mountPage(5);

    store.decide(4, "saved");
    store.decide(5, "skipped");

    expect(document.getElementById("rail-save-n")?.textContent).toBe("1");
    expect(document.getElementById("rail-skip-n")?.textContent).toBe("1");
    expect(document.getElementById("rail-save-slugs")?.textContent).toContain(
      "SPORT-4"
    );
  });

  it("threads the newest decision onto the top of the spindle", () => {
    // The rail is a fixed height and clips once past roughly seven decisions.
    // Oldest-first meant the slugs a reader had just made were the ones that
    // fell off, which is exactly backwards: the spindle should read like a
    // spike, newest on top.
    const store = mountPage(5);

    store.decide(3, "saved");
    store.decide(1, "saved");
    store.decide(5, "saved");

    const slugs = [...document.querySelectorAll("#rail-save-slugs .slug")].map(
      (node) => node.textContent
    );

    expect(slugs).toEqual(["SPORT-5", "SPORT-1", "SPORT-3"]);
  });
});
