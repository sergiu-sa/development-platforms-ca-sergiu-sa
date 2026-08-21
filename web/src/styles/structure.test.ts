import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The stylesheet's shape, as opposed to its values.
 *
 * `contrast.test.ts` reads declarations and checks they clear the floors. It cannot see the failure this file exists for: a rule losing its declaration block, so that its selectors run on into the *next* rule and quietly take that rule's declarations instead.
 *
 * That is legal CSS and it compiles silently. It happened four times while phase 11 was being written, every time from an edit that matched the last line of a selector list instead of a standalone rule:
 *
 *   - `.briefing-mark, .build-mark` fell into the display-voice rule, so the blue 7px square became a font declaration and the mark vanished from three pages
 *   - `.briefing-intro, .bcard-intro` took the curator lede's 17px, changing the briefing view and the shelf card
 *   - the shared content column took the pager's three-column grid, which flattened the whole profile header onto one line
 *   - the prose-link `:hover` rule fell into `.quiet`, so hovering a link *dimmed* it instead of colouring it
 *
 * Typecheck, the full suite, the contrast test and the build were green through every one of them. Only looking at the page found them, and only three of the four were caught that way.
 */

const css = readFileSync(
  fileURLToPath(new URL("./app.css", import.meta.url)),
  "utf-8"
);

interface Rule {
  selectors: string[];
  body: string;
}

/** Every top-level rule, comments stripped, nested at-rule bodies skipped. */
function rules(): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let depth = 0;
  let buf = "";
  let selectors = "";

  for (const c of stripped) {
    if (c === "{") {
      if (depth === 0) {
        selectors = buf;
        buf = "";
      } else {
        buf += c;
      }
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const list = selectors
          .split(",")
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter(Boolean);

        if (list.length > 0 && !list[0].startsWith("@")) {
          out.push({ selectors: list, body: buf.replace(/\s+/g, " ").trim() });
        }
        buf = "";
        selectors = "";
      } else {
        buf += c;
      }
    } else {
      buf += c;
    }
  }

  return out;
}

const parsed = rules();

function declarationsFor(selector: string): string {
  return parsed
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join(" ");
}

describe("stylesheet structure", () => {
  it("parses a plausible number of rules, so the checks below are not vacuous", () => {
    expect(parsed.length).toBeGreaterThan(200);
  });

  it("gives every rule a declaration block", () => {
    const empty = parsed
      .filter((rule) => rule.body === "")
      .map((rule) => rule.selectors.join(", "));

    expect(empty, "These rules declare nothing at all").toEqual([]);
  });

  /**
   * The signature of the damage:
   *  a rule's block goes missing and its selectors join the next rule, which is almost always a differently-shaped one.
   * A hover rule merged into a resting-state rule is the version that has actually happened, and it is unambiguous;
   *  no rule in this file legitimately styles a hover state and a resting state together.
   */
  it("never mixes a hover selector with a resting-state one", () => {
    const mixed = parsed
      .filter(
        (rule) =>
          rule.selectors.some((s) => s.includes(":hover")) &&
          rule.selectors.some((s) => !s.includes(":hover"))
      )
      .map((rule) => rule.selectors.join(", "));

    expect(
      mixed,
      "A rule styling both a hover state and a resting state is almost " +
        "certainly a selector list that lost its block and ran into the next " +
        "rule. Check the rule above it still has declarations of its own."
    ).toEqual([]);
  });

  it("declares no selector in more than two rules", () => {
    // Two is the shared-primitive-plus-override pattern this file uses.
    // Three is a leftover, and one of the three will be dead.
    const counts = new Map<string, number>();
    for (const rule of parsed) {
      for (const selector of rule.selectors) {
        counts.set(selector, (counts.get(selector) ?? 0) + 1);
      }
    }

    const repeated = [...counts.entries()]
      .filter(([, n]) => n > 2)
      .map(([selector, n]) => `${selector} (${n} rules)`);

    expect(repeated).toEqual([]);
  });

  /**
   * The primitives that are shared across pages, pinned to what they actually have to be.
   * Each one of these was silently wrong at some point this phase.
   */
  it("keeps .quiet a rule of its own", () => {
    const rule = parsed.find((r) => r.selectors.includes(".quiet"));

    expect(rule?.selectors).toEqual([".quiet"]);
    expect(rule?.body).toContain("opacity: 0.72");
  });

  it("draws the blue mark as a 7px square on every page that has one", () => {
    for (const selector of [".briefing-mark", ".build-mark", ".prof-mark"]) {
      const body = declarationsFor(selector);

      expect(body, `${selector} is not a 7px square`).toContain("width: 7px");
      expect(body, `${selector} is not blue`).toContain(
        "background: var(--color-blue)"
      );
    }
  });

  it("sets the shared intro at the prose floor, not the lede's size", () => {
    for (const selector of [".briefing-intro", ".bcard-intro"]) {
      expect(declarationsFor(selector), selector).toContain("font-size: 15px");
    }
    // The curator lede overrides it, and is the only one that may.
    expect(declarationsFor(".prof-lede-intro")).toContain("font-size: 17px");
  });

  it("gives a prose link an underline at rest and blue on hover", () => {
    // Colour is never the only signal, and here there is no colour at rest at all;
    //  the underline is the whole affordance.
    expect(declarationsFor(".note a")).toContain("text-decoration: underline");
    expect(declarationsFor(".note a:hover")).toContain(
      "text-decoration-color: var(--color-blue)"
    );
    expect(declarationsFor(".briefing-byline")).toContain(
      "text-decoration: underline"
    );
  });

  it("puts every section of a shelf on one content column", () => {
    for (const selector of [
      ".shelf-head",
      ".bcards",
      ".prof-head",
      ".prof-lede",
      ".prof-rest",
      ".prof-drafts",
      ".pager",
    ]) {
      expect(declarationsFor(selector), selector).toContain("max-width: 60rem");
    }
  });
});
