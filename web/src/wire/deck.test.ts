import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  counts,
  createDeck,
  cursor,
  currentStory,
  dealMore,
  dealtCount,
  deckStatus,
  decide,
  decideCurrent,
  decisionFor,
  nextBatchSize,
  undealt,
  undo,
} from "./deck";
import { makeStories } from "./story.fixture";
import type { Decision } from "./types";

const deckOf = (count: number) => createDeck(makeStories(count));

const restored = (pairs: [number, Decision][]) => new Map(pairs);

describe("createDeck", () => {
  it("deals a batch, clamped to what is on the wire", () => {
    expect(deckOf(20).dealt).toBe(BATCH_SIZE);
    expect(deckOf(5).dealt).toBe(5);
    expect(deckOf(0).dealt).toBe(0);
  });

  it("restores a larger batch the reader had already asked for", () => {
    const deck = createDeck(makeStories(20), { dealt: 20 });
    expect(deck.dealt).toBe(20);
  });

  it("never restores a batch smaller than one deal", () => {
    // A stored 3 would leave the reader with a deck shorter than they started
    // with.
    expect(createDeck(makeStories(20), { dealt: 3 }).dealt).toBe(BATCH_SIZE);
  });

  it("clamps a restored batch to the current wire", () => {
    expect(createDeck(makeStories(6), { dealt: 24 }).dealt).toBe(6);
  });

  it("drops restored decisions for stories that have left the wire", () => {
    // The decision is unreachable: nothing on screen can undo it.
    const deck = createDeck(makeStories(3), {
      decisions: restored([
        [1, "saved"],
        [99, "saved"],
      ]),
    });

    expect(decisionFor(deck, 1)).toBe("saved");
    expect(decisionFor(deck, 99)).toBeNull();
    expect(counts(deck).saved).toBe(1);
  });
});

describe("cursor", () => {
  it("is the first undecided story", () => {
    const deck = deckOf(5);
    expect(cursor(deck)).toBe(0);
    expect(cursor(decideCurrent(deck, "saved"))).toBe(1);
  });

  it("steps over a story decided somewhere other than the deck", () => {
    // Phase 4 lets the browse list decide a story the deck has not reached.
    const deck = decide(deckOf(5), 2, "skipped");
    expect(cursor(decideCurrent(deck, "saved"))).toBe(2);
  });

  it("is null once every dealt story is decided", () => {
    let deck = deckOf(2);
    deck = decideCurrent(deck, "saved");
    deck = decideCurrent(deck, "skipped");

    expect(cursor(deck)).toBeNull();
    expect(currentStory(deck)).toBeNull();
  });

  it("does not see past the batch that has been dealt", () => {
    // Decide exactly the dealt batch on a wire that has more. The cursor must
    // stop, not walk on to story 13.
    //
    // The earlier version of this test only asserted cursor === 0 on a fresh
    // deck, which passes just as well with the clamp removed. This one fails
    // if `cursor` looks at stories.length instead of dealtCount.
    let deck = deckOf(20);
    for (let i = 0; i < BATCH_SIZE; i++) deck = decideCurrent(deck, "skipped");

    expect(cursor(deck)).toBeNull();
    expect(counts(deck).skipped).toBe(BATCH_SIZE);
    expect(deck.stories.length).toBe(20);
  });
});

describe("decide", () => {
  it("advances the deck", () => {
    const deck = deckOf(3);
    const after = decideCurrent(deck, "saved");

    expect(decisionFor(after, 1)).toBe("saved");
    expect(currentStory(after)?.id).toBe(2);
  });

  it("is a no-op past the end of the batch", () => {
    let deck = deckOf(1);
    deck = decideCurrent(deck, "saved");

    // A held-down key must not run off the end.
    expect(decideCurrent(deck, "skipped")).toBe(deck);
  });

  it("is a no-op at the batch boundary even when the wire has more", () => {
    // deckOf(1) cannot tell the batch guard from the wire guard, because both
    // boundaries sit at the same index there.
    let deck = deckOf(20);
    for (let i = 0; i < BATCH_SIZE; i++) deck = decideCurrent(deck, "skipped");

    expect(decideCurrent(deck, "saved")).toBe(deck);
    expect(counts(deck).saved).toBe(0);
  });

  it("does nothing when a story is decided the way it already is", () => {
    // Phase 4's list can press Save on a row that is already saved. Recording
    // that would overwrite lastAction and spend the one step of undo on a
    // change that never happened.
    const saved = decide(deckOf(3), 1, "saved");
    const again = decide(saved, 1, "saved");

    expect(again).toBe(saved);
    expect(again.lastAction).toEqual({ storyId: 1, from: null, to: "saved" });
    expect(decisionFor(undo(again), 1)).toBeNull();
  });

  it("ignores a story that is not on the wire", () => {
    const deck = deckOf(3);
    expect(decide(deck, 404, "saved")).toBe(deck);
  });

  it("leaves the original state untouched", () => {
    const deck = deckOf(3);
    decideCurrent(deck, "saved");
    expect(decisionFor(deck, 1)).toBeNull();
  });
});

describe("undo", () => {
  it("restores the previous decision rather than clearing it", () => {
    // Skipped, then changed to saved. Undo means "I did not mean to save it",
    // not "I never decided it".
    let deck = decide(deckOf(3), 1, "skipped");
    deck = decide(deck, 1, "saved");

    expect(decisionFor(undo(deck), 1)).toBe("skipped");
  });

  it("clears a first decision and returns the deck to that story", () => {
    let deck = deckOf(3);
    deck = decideCurrent(deck, "saved");
    expect(currentStory(deck)?.id).toBe(2);

    deck = undo(deck);
    expect(decisionFor(deck, 1)).toBeNull();
    expect(currentStory(deck)?.id).toBe(1);
  });

  it("does not drag the deck backwards when it restores a decision", () => {
    // Story 1 stays decided, so the deck stays where it was.
    let deck = decide(deckOf(3), 1, "skipped");
    deck = decideCurrent(deck, "saved"); // story 2
    deck = decide(deck, 1, "saved"); // change of mind, from the list
    deck = undo(deck);

    expect(decisionFor(deck, 1)).toBe("skipped");
    expect(currentStory(deck)?.id).toBe(3);
  });

  it("works on the very first story", () => {
    const deck = decideCurrent(deckOf(3), "skipped");
    const after = undo(deck);

    expect(decisionFor(after, 1)).toBeNull();
    expect(cursor(after)).toBe(0);
  });

  it("is a no-op with nothing to undo", () => {
    const deck = deckOf(3);
    expect(undo(deck)).toBe(deck);
  });

  it("steps back once, not repeatedly", () => {
    let deck = deckOf(3);
    deck = decideCurrent(deck, "saved");
    deck = decideCurrent(deck, "saved");

    const once = undo(deck);
    expect(undo(once)).toBe(once);
    expect(decisionFor(once, 1)).toBe("saved");
  });
});

describe("counts", () => {
  it("counts across the whole wire, not just the dealt batch", () => {
    let deck = deckOf(20);
    deck = decideCurrent(deck, "saved");
    deck = decideCurrent(deck, "skipped");
    deck = decide(deck, 18, "saved"); // beyond the batch

    expect(counts(deck)).toEqual({ saved: 2, skipped: 1 });
  });

  it("counts a changed decision once", () => {
    let deck = decide(deckOf(3), 1, "skipped");
    deck = decide(deck, 1, "saved");

    expect(counts(deck)).toEqual({ saved: 1, skipped: 0 });
  });
});

describe("deckStatus", () => {
  it("is empty when the wire is empty", () => {
    expect(deckStatus(deckOf(0))).toBe("empty");
  });

  it("is dealing while a story is on deck", () => {
    expect(deckStatus(deckOf(3))).toBe("dealing");
  });

  it("is batch-done when the batch runs out but the wire has more", () => {
    let deck = deckOf(20);
    for (let i = 0; i < BATCH_SIZE; i++) deck = decideCurrent(deck, "skipped");

    expect(deckStatus(deck)).toBe("batch-done");
    expect(undealt(deck)).toBe(8);
  });

  it("is exhausted when the wire itself runs out", () => {
    let deck = deckOf(3);
    for (let i = 0; i < 3; i++) deck = decideCurrent(deck, "saved");

    expect(deckStatus(deck)).toBe("exhausted");
    expect(undealt(deck)).toBe(0);
  });
});

describe("dealtCount and nextBatchSize", () => {
  it("counts what is really in the deck, not what was asked for", () => {
    // The view and the announcer both say "N of M" from this, so the clamp
    // lives here rather than being re-derived at each surface.
    expect(dealtCount(deckOf(20))).toBe(BATCH_SIZE);
    expect(dealtCount(createDeck(makeStories(5), { dealt: 12 }))).toBe(5);
    expect(dealtCount(deckOf(0))).toBe(0);
  });

  it("reports what the continuation button will actually deal", () => {
    expect(nextBatchSize(deckOf(20))).toBe(8); // a short final batch
    expect(nextBatchSize(deckOf(40))).toBe(BATCH_SIZE); // a full one
    expect(nextBatchSize(deckOf(5))).toBe(0); // nothing left
  });

  it("agrees with what dealMore goes on to do", () => {
    // A button promising eight and dealing twelve is drift nobody sees until
    // it is in front of a reader.
    for (const total of [13, 20, 24, 40]) {
      const deck = deckOf(total);
      const promised = nextBatchSize(deck);
      expect(dealtCount(dealMore(deck)) - dealtCount(deck)).toBe(promised);
    }
  });
});

describe("dealMore", () => {
  it("deals the next batch and stops at the end of the wire", () => {
    const deck = dealMore(deckOf(20));

    expect(deck.dealt).toBe(20);
    expect(deckStatus(deck)).toBe("dealing");
    expect(undealt(deck)).toBe(0);
  });

  it("keeps every decision already made", () => {
    let deck = deckOf(20);
    deck = decideCurrent(deck, "saved");
    deck = dealMore(deck);

    expect(decisionFor(deck, 1)).toBe("saved");
  });

  it("is a no-op once everything has been dealt", () => {
    const deck = dealMore(deckOf(5));
    expect(dealMore(deck)).toBe(deck);
  });

  it("leaves the last decision undoable across the batch boundary", () => {
    // dealMore deliberately keeps lastAction, so Z after "Next 8 stories"
    // reaches back into the batch just finished. Pinned because it is a
    // reasonable thing to change by accident.
    let deck = deckOf(20);
    for (let i = 0; i < BATCH_SIZE; i++) deck = decideCurrent(deck, "skipped");
    deck = dealMore(deck);

    expect(deck.lastAction?.storyId).toBe(BATCH_SIZE);

    deck = undo(deck);
    expect(decisionFor(deck, BATCH_SIZE)).toBeNull();
    expect(currentStory(deck)?.id).toBe(BATCH_SIZE);
  });

  it("loads straight into batch-done when the restored batch is all decided", () => {
    const decisions = new Map<number, Decision>(
      Array.from({ length: BATCH_SIZE }, (_, i) => [i + 1, "saved" as const])
    );
    const deck = createDeck(makeStories(20), { decisions, dealt: BATCH_SIZE });

    expect(deckStatus(deck)).toBe("batch-done");
    expect(deckStatus(dealMore(deck))).toBe("dealing");
  });
});
