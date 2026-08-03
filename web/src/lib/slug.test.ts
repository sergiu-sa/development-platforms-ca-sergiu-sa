import { describe, it, expect } from "vitest";
import { storySlug } from "./slug";

describe("storySlug", () => {
  it("is the first word of the section and the story id", () => {
    expect(storySlug("Sport", 1053)).toBe("SPORT-1053");
  });

  it("takes the first word only", () => {
    expect(storySlug("US news", 12)).toBe("US-12");
    expect(storySlug("Life and style", 3)).toBe("LIFE-3");
  });

  it("truncates a long section to eight characters", () => {
    expect(storySlug("Environment", 9)).toBe("ENVIRONM-9");
  });

  it("falls back to WIRE when there is no usable section", () => {
    expect(storySlug(null, 7)).toBe("WIRE-7");
    expect(storySlug("", 7)).toBe("WIRE-7");
    expect(storySlug("404", 7)).toBe("WIRE-7");
  });

  it("depends on the story, not on where it appears in a list", () => {
    // The rail, the card and the list all label the same story, and the list
    // can be filtered or re-sorted underneath them.
    expect(storySlug("Sport", 1053)).toBe(storySlug("Sport", 1053));
    expect(storySlug("Sport", 1053)).not.toBe(storySlug("Sport", 1054));
  });
});
