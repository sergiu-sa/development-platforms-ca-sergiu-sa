// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { decisionFor } from "./deck";
import { createStore, type DeckStore } from "./store";
import { makeStories } from "./story.fixture";
import { mountTray } from "./tray";

function mountPage(): DeckStore {
  document.body.innerHTML = `
    <div class="tray" id="tray" hidden>
      <span class="m"><b id="tray-n">0</b> on your desk</span>
      <div class="tray-chips" id="tray-chips"></div>
      <div id="tray-cta"></div>
    </div>
  `;

  const store = createStore(makeStories(6));
  mountTray(store);
  return store;
}

const tray = () => document.getElementById("tray")!;
/** Each chip's own label, without the Remove button folded into it. */
const chips = () =>
  [...document.querySelectorAll<HTMLElement>(".tray-chip")].map((chip) => {
    const copy = chip.cloneNode(true) as HTMLElement;
    copy.querySelector("button")?.remove();
    return copy.textContent?.trim();
  });
const click = (el: HTMLElement | null | undefined) =>
  el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the tray", () => {
  it("stays out of the way until something is saved", () => {
    const store = mountPage();
    expect(tray().hidden).toBe(true);

    store.decide(1, "saved");
    expect(tray().hidden).toBe(false);
  });

  it("does not appear for a skipped story", () => {
    // The tray is the desk. Skipping puts nothing on it.
    const store = mountPage();
    store.decide(1, "skipped");

    expect(tray().hidden).toBe(true);
  });

  it("counts what is on the desk, in the words the deck used", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.decide(2, "saved");

    expect(document.getElementById("tray-n")?.textContent).toBe("2");
    expect(document.querySelector(".tray")?.textContent).toContain(
      "on your desk"
    );
  });

  it("does not redraw itself for a decision that cannot reach the desk", () => {
    // Rebuilding the chips and then measuring the tray forces a layout of the
    // whole document. A skip, and an undo of a skip, must not pay for that.
    const store = mountPage();
    store.decide(1, "saved");
    const chip = document.querySelector(".tray-chip");

    store.decide(2, "skipped");
    store.undo();

    expect(document.querySelector(".tray-chip")).toBe(chip);
  });

  it("lists each saved story as a slug", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.decide(3, "saved");

    expect(chips()).toEqual(["SPORT-1", "SPORT-3"]);

    expect(document.querySelector(".tray-chip button")?.textContent).toBe(
      "Remove"
    );
  });

  it("takes a story off the desk from its own chip", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.decide(3, "saved");

    click(
      document.querySelector<HTMLElement>(
        ".tray-chip[data-story-id='1'] button"
      )
    );

    expect(decisionFor(store.get(), 1)).toBeNull();
    expect(chips()).toEqual(["SPORT-3"]);
  });

  it("goes away again when the last story is removed", () => {
    const store = mountPage();
    store.decide(1, "saved");
    store.clear(1);

    expect(tray().hidden).toBe(true);
  });
});

describe("the tray for a signed-out reader", () => {
  it("offers the way to keep what they have collected", () => {
    const store = mountPage();
    store.decide(1, "saved");

    const cta = document.querySelector<HTMLAnchorElement>("#tray-cta a")!;
    expect(cta.textContent).toContain("Sign in to keep these");
    expect(cta.getAttribute("href")).toBe("/login.html?next=%2F");
  });
});

describe("the tray for a signed-in reader", () => {
  it("offers no dead link to a desk that does not exist yet", () => {
    // /desk arrives in phase 7. A button that goes nowhere is worse than no
    // button, and the count and the chips are the tray's real work anyway.
    window.localStorage.setItem("token", "a.b.c");
    const store = mountPage();
    store.decide(1, "saved");

    expect(document.querySelector("#tray-cta a")).toBeNull();
    expect(document.getElementById("tray-n")?.textContent).toBe("1");
    expect(chips()).toEqual(["SPORT-1"]);
  });
});
