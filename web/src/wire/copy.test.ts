import { describe, it, expect } from "vitest";
import { actionLabel, decisionLabel } from "./copy";

describe("decisionLabel", () => {
  it("says what a story is, for the row and the rail", () => {
    expect(decisionLabel("saved")).toBe("Saved");
    expect(decisionLabel("skipped")).toBe("Skipped");
  });
});

describe("actionLabel", () => {
  it("says what just happened, for the toast", () => {
    expect(actionLabel({ storyId: 1, from: null, to: "saved" })).toBe("Saved");
    expect(actionLabel({ storyId: 1, from: null, to: "skipped" })).toBe(
      "Skipped"
    );
  });

  it("names taking a decision back after the verb that offered it", () => {
    // The spec's rule is that an action keeps its name through the whole flow.
    // The button on a saved row says Remove, so the toast has to say Removed -
    // "Undecided" would be the interface inventing a word for itself.
    expect(actionLabel({ storyId: 1, from: "saved", to: null })).toBe(
      "Removed"
    );
    expect(actionLabel({ storyId: 1, from: "skipped", to: null })).toBe(
      "Un-skipped"
    );
  });
});
