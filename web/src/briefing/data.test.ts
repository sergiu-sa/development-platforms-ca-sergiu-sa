// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeBriefing } from "./briefing.fixture";
import { loadBriefing, readInlined } from "./data";

/** A document carrying whatever the server inlined, good or bad. */
function withInlined(json: string): Document {
  const doc = document.implementation.createHTMLDocument("t");
  const script = doc.createElement("script");
  script.type = "application/json";
  script.id = "briefing-data";
  script.textContent = json;
  doc.body.appendChild(script);

  return doc;
}

const empty = () => document.implementation.createHTMLDocument("t");

describe("readInlined", () => {
  it("reads the briefing the server put in the document", () => {
    const briefing = makeBriefing();

    expect(readInlined(withInlined(JSON.stringify(briefing)))?.slug).toBe(
      briefing.slug
    );
  });

  it("returns null rather than throwing on malformed JSON", () => {
    expect(readInlined(withInlined("{not json"))).toBeNull();
  });

  it("returns null when the server inlined nothing", () => {
    expect(readInlined(empty())).toBeNull();
  });

  it("returns null when the payload is not a briefing", () => {
    expect(readInlined(withInlined(JSON.stringify({ nope: true })))).toBeNull();
  });
});

describe("loadBriefing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("does not ask the server when the briefing is already in the page", async () => {
    const briefing = makeBriefing();
    const spy = vi.spyOn(globalThis, "fetch");

    const result = await loadBriefing(
      briefing.slug,
      withInlined(JSON.stringify(briefing))
    );

    expect(result.briefing?.slug).toBe(briefing.slug);
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks the server when the inlined payload is unreadable", async () => {
    const briefing = makeBriefing();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, briefing }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await loadBriefing(briefing.slug, withInlined("{not json"));

    expect(result.briefing?.slug).toBe(briefing.slug);
  });

  it("reports a briefing that is not there without calling it an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await loadBriefing("no-such-thing-0000", empty());

    expect(result.briefing).toBeNull();
    expect(result.status).toBe(404);
  });

  it("uses the inlined briefing even when the address yields no slug", async () => {
    // The generated document served at its own API path has the briefing in it but nothing a slug can be read from.
    // Bailing on the empty slug first threw that payload away and told the reader the briefing did not exist.
    const briefing = makeBriefing();
    const spy = vi.spyOn(globalThis, "fetch");

    const result = await loadBriefing(
      "",
      withInlined(JSON.stringify(briefing))
    );

    expect(result.briefing?.slug).toBe(briefing.slug);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not ask for a briefing it has no name for", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    const result = await loadBriefing("", empty());

    expect(result.briefing).toBeNull();
    expect(result.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a failed connection as status 0, not as a missing briefing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const result = await loadBriefing("anything-0000", empty());

    expect(result.briefing).toBeNull();
    expect(result.status).toBe(0);
  });
});
