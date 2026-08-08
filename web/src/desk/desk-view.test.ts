// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeStory } from "../wire/story.fixture";
import type { Story } from "../wire/types";
import {
  mountRemove,
  renderArchive,
  renderEdition,
  renderMasthead,
  showDeskError,
} from "./desk-view";
import { editionFacts } from "./edition";
import type { DeskEntry } from "./types";

const NOW = new Date("2026-08-06T18:00:00.000Z");

function entry(
  over: Partial<Story> = {},
  decidedAt = "2026-08-06T09:12:00.000Z"
): DeskEntry {
  const story = makeStory(over);
  return { storyId: story.id, state: "saved", decidedAt, story };
}

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});

describe("renderEdition", () => {
  it("draws the lead as the wire's card, unchanged", () => {
    renderEdition(root, [entry({ id: 1 })], NOW);

    // The card, not a desk-only imitation of one. If this ever stops being the wire's component the two publications have quietly diverged.
    expect(root.querySelector(".ed-lead .card")).not.toBeNull();
    expect(root.querySelector(".ed-lead")?.getAttribute("data-story-id")).toBe(
      "1"
    );
  });

  it("gives the lead a Remove of its own", () => {
    renderEdition(root, [entry({ id: 1 })], NOW);

    const button = root.querySelector(".ed-lead [data-act='remove']");

    // Without this the biggest story on the desk is the one story that cannot be taken off it.
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toContain("Story 1");
  });

  it("draws every other story as a band under its pillar", () => {
    renderEdition(
      root,
      [
        entry({ id: 1, pillar: "News" }),
        entry({ id: 2, pillar: "Sport" }),
        entry({ id: 3, pillar: "Sport" }),
      ],
      NOW
    );

    expect(root.querySelectorAll(".band")).toHaveLength(2);
    expect(
      [...root.querySelectorAll(".pillar h2")].map((h) => h.textContent)
    ).toEqual(["Sport"]);
  });

  // Blue is the reader's hand and red is the machine's time, and the desk uses both exactly once:
  // the kept time is theirs, and Remove is the only irreversible control in the product.
  it("tints Remove so its hover can warn, unlike the wire's own Remove", () => {
    renderEdition(root, [entry({ id: 1 }), entry({ id: 2 })], NOW);

    const button = root.querySelector(".band [data-act='remove']");

    expect(button?.className).toContain("mini-remove");
  });

  // The stylesheet tints .band-f .read-time and nothing else in the line, so the class has to be on the reading time and only there.
  it("marks the reading time so the desk can tint it alone", () => {
    renderEdition(root, [entry({ id: 1 }), entry({ id: 2 })], NOW);

    const facts = root.querySelector(".band .band-f")!;
    const tinted = [...facts.querySelectorAll(".read-time")];

    expect(tinted).toHaveLength(1);
    expect(tinted[0].textContent).toMatch(/^\d+ min read$/);
    // The section and the publish time share the line and must not be picked up by the same selector.
    expect(facts.querySelector("time")?.classList.contains("read-time")).toBe(
      false
    );
  });

  it("prints the time the story was kept, with a label for a screen reader", () => {
    renderEdition(
      root,
      [entry({ id: 1 }), entry({ id: 2 }, "2026-08-06T14:45:00.000Z")],
      NOW
    );

    const time = root.querySelector(".band-t");

    // The one fact the desk has and the wire does not, so it is worth pinning.
    expect(time?.textContent).toContain("Kept at");
    expect(time?.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("omits the reading time on a live blog rather than inventing one", () => {
    renderEdition(
      root,
      [
        entry({ id: 1 }),
        entry({ id: 2, tone: "minutebyminute", wordCount: 5000 }),
      ],
      NOW
    );

    const band = root.querySelector(".band");

    // A live blog's word count is only what has been posted so far, so any number here is a lie that grows all afternoon.
    expect(band?.textContent).not.toMatch(/\d+ min\b/);
    expect(band?.hasAttribute("data-m")).toBe(false);
  });

  it("marks a story with no photograph so the copy takes the space", () => {
    renderEdition(
      root,
      [entry({ id: 1 }), entry({ id: 2, imageUrl: null, thumbnailUrl: null })],
      NOW
    );

    expect(root.querySelector(".band")?.getAttribute("data-shot")).toBe("none");
    expect(root.querySelector(".band .band-shot")).toBeNull();
  });

  // Every interpolated field becomes HTML, and the wire is somebody else's.
  it("escapes the headline, the standfirst and the alt text", () => {
    renderEdition(
      root,
      [
        entry({ id: 1 }),
        entry({
          id: 2,
          title: '<img src=x onerror="alert(1)">',
          standfirst: "<script>alert(2)</script>",
          imageAlt: '" onload="alert(3)',
        }),
      ],
      NOW
    );

    const band = root.querySelector(".band")!;

    expect(band.querySelector("script")).toBeNull();
    expect(band.querySelectorAll("img")).toHaveLength(1);
    expect(band.querySelector(".band-h")?.textContent).toContain("onerror");
  });

  it("renders no link at all for a story whose url is not http", () => {
    renderEdition(
      root,
      [entry({ id: 1 }), entry({ id: 2, url: "javascript:alert(1)" })],
      NOW
    );

    const headline = root.querySelector(".band .band-h");

    expect(headline?.querySelector("a")).toBeNull();
    expect(headline?.textContent).toContain("Story 2");
  });

  it("invites rather than shrugs when the day is empty", () => {
    renderEdition(root, [], NOW);

    expect(root.textContent).toContain("Nothing kept on this day");
    expect(root.querySelector("a[href='/index.html']")).not.toBeNull();
    // -30- is spent in exactly two places, the deck's cleared state and the footer.
    // A third use would make it decoration.
    expect(root.textContent).not.toContain("-30-");
  });
});

describe("renderMasthead", () => {
  let dateEl: HTMLElement;
  let factsEl: HTMLElement;

  beforeEach(() => {
    dateEl = document.createElement("span");
    factsEl = document.createElement("span");
  });

  it("prints the edition's date and its facts", () => {
    renderMasthead(
      dateEl,
      factsEl,
      editionFacts([entry({ id: 1 })]),
      "2026-08-06"
    );

    expect(dateEl.textContent).toBe("Thursday, 6 August 2026");
    expect(factsEl.textContent).toBe("1 story · 2 minutes");
  });

  it("pluralises the count", () => {
    renderMasthead(
      dateEl,
      factsEl,
      editionFacts([entry({ id: 1 }), entry({ id: 2 })]),
      "2026-08-06"
    );

    expect(factsEl.textContent).toBe("2 stories · 4 minutes");
  });

  it("drops the minutes entirely when nothing has a reading time", () => {
    renderMasthead(
      dateEl,
      factsEl,
      editionFacts([entry({ id: 1, tone: "minutebyminute" })]),
      "2026-08-06"
    );

    expect(factsEl.textContent).toBe("1 story");
  });
});

describe("renderArchive", () => {
  let nav: HTMLElement;
  let strip: HTMLElement;

  beforeEach(() => {
    nav = document.createElement("nav");
    nav.hidden = true;
    strip = document.createElement("div");
  });

  // The rule that stranded a reader:
  // their only saves were on an earlier day, the strip hid itself for having "fewer than two days", and today's empty state offered no route to the edition they actually had.
  it("shows the strip when the only edition is a day the reader is not on", () => {
    renderArchive(
      nav,
      strip,
      [{ day: "2026-08-05", count: 3, isToday: false }],
      "2026-08-06"
    );

    expect(nav.hidden).toBe(false);
    expect(strip.querySelector(".archive-day")?.getAttribute("href")).toBe(
      "/desk.html?date=2026-08-05"
    );
  });

  it("hides again when a redraw leaves nowhere else to go", () => {
    renderArchive(
      nav,
      strip,
      [
        { day: "2026-08-06", count: 1, isToday: true },
        { day: "2026-08-05", count: 1, isToday: false },
      ],
      "2026-08-06"
    );
    expect(nav.hidden).toBe(false);

    // The 5th's last story is removed, so only today is left and today is here.
    renderArchive(
      nav,
      strip,
      [{ day: "2026-08-06", count: 1, isToday: true }],
      "2026-08-06"
    );

    expect(nav.hidden).toBe(true);
    expect(strip.innerHTML).toBe("");
  });

  it("stays hidden when today is the only edition", () => {
    renderArchive(
      nav,
      strip,
      [{ day: "2026-08-06", count: 3, isToday: true }],
      "2026-08-06"
    );

    expect(nav.hidden).toBe(true);
    expect(strip.innerHTML).toBe("");
  });

  it("lists the days with their counts once there is more than one", () => {
    renderArchive(
      nav,
      strip,
      [
        { day: "2026-08-06", count: 3, isToday: true },
        { day: "2026-08-04", count: 1, isToday: false },
      ],
      "2026-08-06"
    );

    const days = [...strip.querySelectorAll(".archive-day")];

    expect(nav.hidden).toBe(false);
    expect(days).toHaveLength(2);
    expect(days[0].textContent).toContain("Today");
    expect(days[1].textContent).toContain("4 Aug");
    expect(days[1].getAttribute("href")).toBe("/desk.html?date=2026-08-04");
  });

  it("pluralises the count it reads out", () => {
    renderArchive(
      nav,
      strip,
      [
        { day: "2026-08-06", count: 3, isToday: true },
        { day: "2026-08-04", count: 1, isToday: false },
      ],
      "2026-08-06"
    );

    const days = [...strip.querySelectorAll(".archive-day")];

    // The number is visible, so the word beside it is only ever heard;
    // which is exactly why "1 stories" survived a browser check and not a test.
    expect(days[0].querySelector(".sr-only")?.textContent).toBe(" stories");
    expect(days[1].querySelector(".sr-only")?.textContent).toBe(" story");
  });

  // Colour is never the only signal: the filled chip is backed by aria-current.
  it("marks the edition being read with aria-current, not just a fill", () => {
    renderArchive(
      nav,
      strip,
      [
        { day: "2026-08-06", count: 3, isToday: true },
        { day: "2026-08-04", count: 1, isToday: false },
      ],
      "2026-08-04"
    );

    const current = strip.querySelectorAll("[aria-current='page']");

    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("4 Aug");
  });
});

describe("mountRemove", () => {
  /** Answers every DELETE with one status, and records what was asked for. */
  function stubDelete(status: number): { calls: string[] } {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ success: status === 200 }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
    return { calls };
  }

  const click = async (button: Element) => {
    (button as HTMLButtonElement).click();
    // The handler awaits the request, so yield until it has settled.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports which story went, and leaves the page to the caller", async () => {
    stubDelete(200);
    renderEdition(root, [entry({ id: 1 }), entry({ id: 2 })], NOW);
    const removed: number[] = [];
    mountRemove(root, (id) => removed.push(id));

    await click(root.querySelector(".band [data-act='remove']")!);

    expect(removed).toEqual([2]);
  });

  // Redrawing from what is left is the caller's job, and it is what keeps the lead, the sections, the masthead and the archive from disagreeing.
  // Three of those went wrong when this function stitched the DOM itself.
  it("leaves the redraw to the caller rather than stitching the DOM", async () => {
    stubDelete(200);
    const entries = [
      entry({ id: 1, pillar: "News" }),
      entry({ id: 2, pillar: "Sport" }),
    ];
    renderEdition(root, entries, NOW);
    mountRemove(root, (id) => {
      renderEdition(
        root,
        entries.filter((e) => e.storyId !== id),
        NOW
      );
    });

    await click(root.querySelector(".band [data-act='remove']")!);

    // No band, and no heading left announcing a section that is now empty.
    expect(root.querySelector(".band")).toBeNull();
    expect(root.querySelector(".pillar")).toBeNull();
  });

  // Removing the lead used to leave the page with no card at all;
  // a column of rows, which is the one shape the design rules out.
  it("lets the caller promote a new lead when the lead is removed", async () => {
    stubDelete(200);
    const entries = [entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3 })];
    renderEdition(root, entries, NOW);
    mountRemove(root, (id) => {
      renderEdition(
        root,
        entries.filter((e) => e.storyId !== id),
        NOW
      );
    });

    await click(root.querySelector(".ed-lead [data-act='remove']")!);

    expect(root.querySelector(".ed-lead .card")).not.toBeNull();
    expect(root.querySelector(".ed-lead")?.getAttribute("data-story-id")).toBe(
      "2"
    );
  });

  it("can remove the lead, which is a story like any other", async () => {
    stubDelete(200);
    renderEdition(root, [entry({ id: 1 })], NOW);
    const removed: number[] = [];
    mountRemove(root, (id) => removed.push(id));

    await click(root.querySelector(".ed-lead [data-act='remove']")!);

    expect(removed).toEqual([1]);
  });

  // The desk has no undo, so a removal that did not happen must not look like one that did;
  // the opposite of how the homepage treats a lost decision.
  it("moves the accessible label with the visible one while it works", async () => {
    // An aria-label overrides the contents it sits on, so swapping only the text changed what is seen and nothing of what is heard.
    renderEdition(root, [entry({ id: 1 }), entry({ id: 2 })], NOW);
    const button = root.querySelector<HTMLButtonElement>(
      ".band [data-act='remove']"
    )!;

    let seen = "";
    vi.stubGlobal("fetch", async () => {
      // Read mid-flight, from the button that was actually pressed;
      // the lead's button comes first in the DOM and is untouched.
      seen = button.getAttribute("aria-label") ?? "";
      return new Response("{}", { status: 200 });
    });
    mountRemove(root, () => {});

    await click(button);

    expect(seen).toMatch(/^Removing /);
  });

  it("keeps the story and says so when the server refuses", async () => {
    stubDelete(500);
    renderEdition(root, [entry({ id: 1 }), entry({ id: 2 })], NOW);
    const removed: number[] = [];
    mountRemove(root, (id) => removed.push(id));

    const button = root.querySelector<HTMLButtonElement>(
      ".band [data-act='remove']"
    )!;
    await click(button);

    expect(removed).toEqual([]);
    expect(root.querySelector(".band")).not.toBeNull();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Remove");
    expect(root.querySelector(".band-msg")?.textContent).toContain(
      "Not removed"
    );
    // A live region has to exist before its content changes to be announced, so the label is restored too rather than left saying "Removing".
    expect(root.querySelector(".band-msg")?.getAttribute("role")).toBe(
      "status"
    );
    expect(button.getAttribute("aria-label")).toMatch(/^Remove /);
  });

  it("does not fire twice while a removal is in flight", async () => {
    const { calls } = stubDelete(200);
    renderEdition(root, [entry({ id: 1 }), entry({ id: 2 })], NOW);
    mountRemove(root, () => {});

    const button = root.querySelector<HTMLButtonElement>(
      ".band [data-act='remove']"
    )!;
    button.click();
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toHaveLength(1);
  });
});

describe("showDeskError", () => {
  // "We could not ask" and "you kept nothing" must never read the same.
  it("says the desk could not be read, not that it is empty", () => {
    showDeskError(root);

    expect(root.textContent).toContain("could not be loaded");
    expect(root.textContent).not.toContain("Nothing kept");
  });
});
