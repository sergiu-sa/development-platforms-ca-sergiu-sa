import { describe, it, expect } from "vitest";
import { makeStory } from "../wire/story.fixture";
import type { Story } from "../wire/types";
import {
  composeArchive,
  composeEdition,
  dayBounds,
  dayFromQuery,
  dayKey,
  editionFacts,
  minutesOf,
  OTHER,
  pickLead,
  pillarOf,
} from "./edition";
import type { DeskDecision, DeskEntry } from "./types";

function entry(over: Partial<Story> = {}, decidedAt = "2026-08-06T09:00:00Z") {
  const story = makeStory(over);
  return { storyId: story.id, state: "saved", decidedAt, story } as DeskEntry;
}

describe("dayKey", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // Constructed from local parts, so this is 6 August wherever it runs;
    // including the offsets where the UTC date is the 5th or the 7th.
    const lateNight = new Date(2026, 7, 6, 23, 45);
    const earlyMorning = new Date(2026, 7, 6, 0, 15);

    expect(dayKey(lateNight)).toBe("2026-08-06");
    expect(dayKey(earlyMorning)).toBe("2026-08-06");
  });

  it("pads a single-digit month and day", () => {
    expect(dayKey(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("dayBounds", () => {
  it("spans exactly one local day, from inclusive and to exclusive", () => {
    const { from, to } = dayBounds("2026-08-06");

    // The instants themselves depend on the machine's offset, which is the point.
    // What must hold everywhere is that they are that day's midnights.
    expect(dayKey(new Date(from))).toBe("2026-08-06");
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getMinutes()).toBe(0);
    expect(dayKey(new Date(to))).toBe("2026-08-07");
    expect(new Date(to).getHours()).toBe(0);
  });

  it("hands consecutive days a shared boundary rather than a gap", () => {
    expect(dayBounds("2026-08-06").to).toBe(dayBounds("2026-08-07").from);
  });

  // The reason this is built from the Date constructor rather than by adding 86_400_000:
  // on the day a clock changes, a day is not 24 hours.
  // Under a zone that observes DST one of these spans 23 or 25 hours, and the bounds must still be that day's two midnights.
  it("still spans one day across a daylight-saving change", () => {
    for (const day of ["2026-03-29", "2026-10-25"]) {
      const { from, to } = dayBounds(day);
      const hours = (Date.parse(to) - Date.parse(from)) / 3_600_000;

      expect([23, 24, 25]).toContain(hours);
      expect(new Date(from).getHours()).toBe(0);
      expect(new Date(to).getHours()).toBe(0);
    }
  });
});

describe("dayFromQuery", () => {
  const TODAY = new Date(2026, 7, 7, 10, 0);

  it("takes a real date from the query string", () => {
    expect(dayFromQuery("?date=2026-08-06", TODAY)).toBe("2026-08-06");
  });

  it("falls back to today when there is no date", () => {
    expect(dayFromQuery("", TODAY)).toBe("2026-08-07");
    expect(dayFromQuery("?other=1", TODAY)).toBe("2026-08-07");
  });

  it("falls back to today on a wrongly shaped value", () => {
    for (const bad of [
      "yesterday",
      "2026-8-6",
      "06-08-2026",
      "2026-08-06T12",
    ]) {
      expect(dayFromQuery(`?date=${bad}`, TODAY)).toBe("2026-08-07");
    }
  });

  // The shape test alone is not enough, and this is the case that proves it:
  // "2026-13-45" matches \d{4}-\d{2}-\d{2}, and the Date constructor rolls it forward into February 2027 without complaint.
  // The page would then draw a masthead for a day the reader never asked for.
  it("falls back to today on a date that does not exist", () => {
    for (const impossible of ["2026-13-45", "2026-02-30", "2026-00-10"]) {
      expect(dayFromQuery(`?date=${impossible}`, TODAY)).toBe("2026-08-07");
    }
  });

  // The server floors its window at the epoch, so a day the client would send below that comes back 400 and the page reports an outage for a typo.
  // Note 1970-01-01 is caught too in every zone east of UTC, where its local midnight is 1969-12-31T23:00Z;
  // and the suite pins TZ to one of those.
  it("falls back on a day the server's window could not express", () => {
    for (const old of ["1969-12-31", "1900-06-15", "1970-01-01"]) {
      expect(dayFromQuery(`?date=${old}`, TODAY)).toBe("2026-08-07");
    }
  });

  it("still accepts the first day the window can express", () => {
    expect(dayFromQuery("?date=1970-01-02", TODAY)).toBe("1970-01-02");
  });

  it("accepts the last day of a real month", () => {
    expect(dayFromQuery("?date=2026-02-28", TODAY)).toBe("2026-02-28");
    expect(dayFromQuery("?date=2026-12-31", TODAY)).toBe("2026-12-31");
  });
});

describe("pillarOf", () => {
  it("keeps a pillar the paper has a section for", () => {
    expect(pillarOf(makeStory({ pillar: "Arts" }))).toBe("Arts");
  });

  it("sends a null pillar to the other bucket", () => {
    expect(pillarOf(makeStory({ pillar: null }))).toBe(OTHER);
  });

  // Guardian pillar names are a fixed set, but the desk should not invent a section for one this build has never heard of.
  it("sends an unrecognised pillar to the other bucket", () => {
    expect(pillarOf(makeStory({ pillar: "Weather" }))).toBe(OTHER);
  });
});

describe("minutesOf", () => {
  it("is null for a live blog, whose word count is only what has been posted", () => {
    expect(minutesOf(makeStory({ tone: "minutebyminute" }))).toBeNull();
  });

  it("is null when the word count is missing", () => {
    expect(minutesOf(makeStory({ wordCount: null }))).toBeNull();
  });

  it("rounds an ordinary story at 230 words a minute", () => {
    expect(minutesOf(makeStory({ wordCount: 460 }))).toBe(2);
  });
});

describe("pickLead", () => {
  it("takes the newest save, which is the first entry", () => {
    const newest = entry({ id: 1 });
    const older = entry({ id: 2 });

    expect(pickLead([newest, older])).toBe(newest);
  });

  // Every row cached before phase 1 has no image, so this is a real case:
  // a lead drawn large with nothing to draw is the weakest thing on the page.
  it("skips a newest save that has no photograph", () => {
    const noPicture = entry({ id: 1, imageUrl: null, thumbnailUrl: null });
    const withPicture = entry({ id: 2 });

    expect(pickLead([noPicture, withPicture])).toBe(withPicture);
  });

  it("falls back to the newest when nothing has a photograph", () => {
    const first = entry({ id: 1, imageUrl: null, thumbnailUrl: null });
    const second = entry({ id: 2, imageUrl: null, thumbnailUrl: null });

    expect(pickLead([first, second])).toBe(first);
  });

  it("accepts a story that has only the 500px thumbnail", () => {
    const thumbOnly = entry({ id: 1, imageUrl: null });

    expect(pickLead([thumbOnly])).toBe(thumbOnly);
  });

  it("is null for an empty desk", () => {
    expect(pickLead([])).toBeNull();
  });
});

describe("composeEdition", () => {
  it("puts the lead outside the sections so it appears once", () => {
    const lead = entry({ id: 1, pillar: "News" });
    const other = entry({ id: 2, pillar: "News" });

    const edition = composeEdition([lead, other]);

    expect(edition.lead).toBe(lead);
    expect(edition.sections).toHaveLength(1);
    expect(edition.sections[0].entries).toEqual([other]);
  });

  it("orders sections as a paper prints them, not by how many were saved", () => {
    const edition = composeEdition([
      entry({ id: 1, pillar: "News" }),
      entry({ id: 2, pillar: "Lifestyle" }),
      entry({ id: 3, pillar: "Sport" }),
      entry({ id: 4, pillar: "Lifestyle" }),
      entry({ id: 5, pillar: "News" }),
    ]);

    expect(edition.sections.map((s) => s.pillar)).toEqual([
      "News",
      "Sport",
      "Lifestyle",
    ]);
  });

  it("puts the other bucket last, after every real pillar", () => {
    const edition = composeEdition([
      entry({ id: 1, pillar: "News" }),
      entry({ id: 2, pillar: null }),
      entry({ id: 3, pillar: "Arts" }),
      entry({ id: 4, pillar: "News" }),
    ]);

    expect(edition.sections.map((s) => s.pillar)).toEqual([
      "News",
      "Arts",
      OTHER,
    ]);
  });

  it("keeps the order stories were saved in within a section", () => {
    const edition = composeEdition([
      entry({ id: 1, pillar: "Sport" }),
      entry({ id: 2, pillar: "Sport" }),
      entry({ id: 3, pillar: "Sport" }),
    ]);

    expect(edition.sections[0].entries.map((e) => e.storyId)).toEqual([2, 3]);
  });

  it("is an empty edition rather than a broken one for an empty day", () => {
    const edition = composeEdition([]);

    expect(edition).toEqual({ lead: null, sections: [] });
  });
});

describe("editionFacts", () => {
  it("counts every story, including the lead", () => {
    expect(editionFacts([entry({ id: 1 }), entry({ id: 2 })]).storyCount).toBe(
      2
    );
  });

  // The masthead prints this, so a live blog contributing an invented number would put the lie the design forbids into the edition's own facts line.
  it("sums reading time and lets live blogs contribute nothing", () => {
    const facts = editionFacts([
      entry({ id: 1, wordCount: 460 }),
      entry({ id: 2, wordCount: 690 }),
      entry({ id: 3, tone: "minutebyminute", wordCount: 5000 }),
    ]);

    expect(facts).toEqual({ storyCount: 3, minutes: 5 });
  });

  it("is zero and zero for an empty day", () => {
    expect(editionFacts([])).toEqual({ storyCount: 0, minutes: 0 });
  });
});

describe("composeArchive", () => {
  const decision = (decidedAt: string, state = "saved"): DeskDecision =>
    ({ storyId: 1, state, decidedAt }) as DeskDecision;

  it("counts the saves on each day, newest day first", () => {
    const archive = composeArchive(
      [
        decision(new Date(2026, 7, 6, 9).toISOString()),
        decision(new Date(2026, 7, 6, 17).toISOString()),
        decision(new Date(2026, 7, 4, 12).toISOString()),
      ],
      new Date(2026, 7, 6, 18)
    );

    expect(archive).toEqual([
      { day: "2026-08-06", count: 2, isToday: true },
      { day: "2026-08-04", count: 1, isToday: false },
    ]);
  });

  // Skips are machinery for the deck.
  // An edition is what was kept, and counting dismissals would make the strip claim days the reader kept nothing at all.
  it("ignores skips entirely", () => {
    const archive = composeArchive(
      [
        decision(new Date(2026, 7, 6, 9).toISOString(), "skipped"),
        decision(new Date(2026, 7, 5, 9).toISOString()),
      ],
      new Date(2026, 7, 6, 18)
    );

    expect(archive).toEqual([{ day: "2026-08-05", count: 1, isToday: false }]);
  });

  it("groups by the reader's local day", () => {
    const archive = composeArchive(
      [decision(new Date(2026, 7, 6, 23, 50).toISOString())],
      new Date(2026, 7, 6, 23, 55)
    );

    expect(archive[0].day).toBe("2026-08-06");
    expect(archive[0].isToday).toBe(true);
  });

  it("is empty when nothing has ever been saved", () => {
    expect(composeArchive([], new Date(2026, 7, 6))).toEqual([]);
  });
});
