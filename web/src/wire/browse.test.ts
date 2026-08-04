// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { mountBrowse, showWireError } from "./browse";
import { decisionFor } from "./deck";
import { createStore, type DeckStore } from "./store";
import { makeStory } from "./story.fixture";
import type { Story } from "./types";

const WIRE: Story[] = [
  makeStory({ id: 1, pillar: "Sport", title: "One" }),
  makeStory({ id: 2, pillar: "News", title: "Two" }),
  makeStory({ id: 3, pillar: "Sport", title: "Three" }),
  makeStory({ id: 4, pillar: "News", title: "Four" }),
];

function mountPage(stories: Story[] = WIRE, stale = false): DeckStore {
  document.body.innerHTML = `
    <div class="stale m" id="wire-stale" hidden></div>
    <div class="controls" id="browse-controls"></div>
    <div id="wire-container"></div>
  `;

  const store = createStore(stories);
  mountBrowse(store, { stale, fetchedAt: "2026-08-01T14:00:00.000Z" });
  return store;
}

const rows = () =>
  [...document.querySelectorAll<HTMLElement>(".row")].map((row) =>
    Number(row.dataset.storyId)
  );

const rowFor = (id: number) =>
  document.querySelector<HTMLElement>(`.row[data-story-id="${id}"]`)!;

const chip = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("#browse-controls .chip")].find(
    (node) => node.textContent?.trim() === label
  )!;

const click = (el: HTMLElement | null | undefined) =>
  el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the list", () => {
  it("draws every story on the wire", () => {
    mountPage();
    expect(rows()).toEqual([1, 2, 3, 4]);
  });

  it("offers a chip for each pillar, plus Everything", () => {
    mountPage();
    const labels = [...document.querySelectorAll("#browse-controls .chip")].map(
      (node) => node.textContent?.trim()
    );

    expect(labels).toContain("Everything");
    expect(labels).toContain("News");
    expect(labels).toContain("Sport");
  });

  it("narrows to a pillar when its chip is pressed", () => {
    mountPage();

    click(chip("Sport"));

    expect(rows()).toEqual([1, 3]);
    expect(chip("Sport").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Everything").getAttribute("aria-pressed")).toBe("false");
  });

  it("comes back to everything", () => {
    mountPage();
    click(chip("Sport"));
    click(chip("Everything"));

    expect(rows()).toEqual([1, 2, 3, 4]);
  });

  it("shows a way out when a filter leaves nothing", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.decide(3, "saved");

    click(chip("Sport"));
    click(document.getElementById("browse-hide"));

    expect(rows()).toEqual([]);
    expect(document.querySelector(".blank")).not.toBeNull();

    click(document.querySelector<HTMLElement>("[data-act='reset']"));
    expect(rows()).toEqual([1, 2, 3, 4]);
  });

  it("says the wire is quiet rather than showing an error", () => {
    mountPage([]);

    expect(document.getElementById("wire-container")?.textContent).toContain(
      "The wire is quiet."
    );
  });

  it("puts the controls away when there is nothing to filter", () => {
    // An empty control bar still holds its own padding open above the panel
    // that explains the wire is quiet.
    mountPage([]);

    expect(document.getElementById("browse-controls")?.hidden).toBe(true);
  });

  it("shows a stale wire's stories with a quiet timestamp, never a banner", () => {
    mountPage(WIRE, true);

    expect(document.getElementById("wire-stale")?.hidden).toBe(false);
    expect(document.getElementById("wire-stale")?.textContent).toContain(
      "Last updated"
    );
    expect(rows()).toEqual([1, 2, 3, 4]);
  });

  it("hides the stale note when the wire is fresh", () => {
    mountPage();
    expect(document.getElementById("wire-stale")?.hidden).toBe(true);
  });
});

describe("deciding from the list", () => {
  it("writes through to the one store the deck reads", () => {
    // The roadmap's warning for this phase: one state model, not two.
    const store = mountPage();

    click(rowFor(3).querySelector<HTMLElement>("[data-act='save']"));

    expect(decisionFor(store.get(), 3)).toBe("saved");
  });

  it("skips from the list", () => {
    const store = mountPage();

    click(rowFor(2).querySelector<HTMLElement>("[data-act='skip']"));

    expect(decisionFor(store.get(), 2)).toBe("skipped");
  });

  it("takes a decision back, and offers the verb that matches", () => {
    const store = mountPage();

    click(rowFor(1).querySelector<HTMLElement>("[data-act='save']"));
    expect(rowFor(1).querySelector("[data-act='clear']")?.textContent).toBe(
      "Remove"
    );

    click(rowFor(1).querySelector<HTMLElement>("[data-act='clear']"));
    expect(decisionFor(store.get(), 1)).toBeNull();
  });

  it("shows a decision the deck made, without being told twice", () => {
    const store = mountPage();

    store.decideCurrent("saved");

    expect(rowFor(1).dataset.state).toBe("saved");
    expect(rowFor(1).querySelector(".row-state")?.textContent).toBe("Saved");
  });

  it("marks the story the deck is holding", () => {
    const store = mountPage();

    expect(rowFor(1).querySelector(".row-state")?.textContent).toBe("On deck");

    store.decideCurrent("saved");
    expect(rowFor(2).querySelector(".row-state")?.textContent).toBe("On deck");
  });
});

describe("keeping the reader's place", () => {
  it("paints a decision onto the rows already on screen rather than redrawing", () => {
    // Redrawing twenty rows on every keypress drops the focus of anyone who
    // had tabbed into one. The node has to survive the decision.
    const store = mountPage();
    const before = rowFor(4);

    store.decideCurrent("saved");

    expect(rowFor(4)).toBe(before);
  });

  it("moves focus somewhere real when hide-decided removes the row under it", () => {
    // With hide-decided on, saving from a row deletes the button that was
    // just pressed. Focus would fall to <body> and a keyboard walk would
    // restart at the top of the document.
    const store = mountPage();
    click(document.getElementById("browse-hide"));

    const save = rowFor(2).querySelector<HTMLElement>("[data-act='save']")!;
    save.focus();
    click(save);

    expect(decisionFor(store.get(), 2)).toBe("saved");
    expect(rows()).not.toContain(2);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});

describe("a wire that could not be loaded", () => {
  it("says so, and does not pretend the newsroom is quiet", () => {
    document.body.innerHTML = `
      <div class="stale m" id="wire-stale" hidden></div>
      <div class="controls" id="browse-controls"></div>
      <div id="wire-container"></div>
    `;

    showWireError();

    const container = document.getElementById("wire-container")!;
    expect(container.textContent).toContain("The wire is unavailable.");
    expect(container.textContent).not.toContain("quiet");
    expect(document.getElementById("browse-controls")?.hidden).toBe(true);
  });
});
