// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getDesk, safeNext } from "./api";

describe("safeNext", () => {
  it("allows a same-origin path", () => {
    expect(safeNext("/b/abc")).toBe("/b/abc");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe("/");
  });

  // The actual hole: several browsers treat a leading "/\" the same as "//"
  // when resolving a URL, because backslash is folded into a path/authority
  // separator for special schemes (http/https). "/\evil.com" therefore
  // navigates off-site exactly like "//evil.com" would, even though a naive
  // `startsWith("/") && !startsWith("//")` check lets it through.
  it("rejects a backslash-led scheme-relative URL", () => {
    expect(safeNext("/\\evil.com")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
  });

  it("rejects a missing value", () => {
    expect(safeNext(null)).toBe("/");
  });

  it("rejects an empty string", () => {
    expect(safeNext("")).toBe("/");
  });

  // The value normally arrives already url-decoded, via
  // `URLSearchParams.get()`, so "%2f%2fevil.com" in the address bar is what
  // safeNext actually receives as "//evil.com" - already covered above. This
  // checks the function is still safe if some future caller passes the raw,
  // un-decoded value directly: it doesn't literally start with "/", so it is
  // rejected rather than accidentally allowed through.
  it("rejects a raw percent-encoded value that was never decoded", () => {
    expect(safeNext("%2f%2fevil.com")).toBe("/");
  });

  // A tab or newline anywhere in the string is stripped by the browser's URL
  // parser before the URL is resolved, not just at the ends. A value that
  // looks like a safe single-slash path here can still turn into
  // "//evil.com" once the embedded newline disappears during navigation.
  it("rejects a value with an embedded newline", () => {
    expect(safeNext("/\n/evil.com")).toBe("/");
  });

  it("rejects a value with an embedded tab", () => {
    expect(safeNext("/\t/evil.com")).toBe("/");
  });
});

/**
 * The session going with the token is a security fix, not housekeeping.
 *
 * logout() has cleared sessionStorage since phase 3, with a comment saying
 * why: this lands the reader on the sign-in form, and the next person to sign
 * in there has whatever is left folded onto their desk by the phase 6
 * migration. An expired token reaches the same form by a different door, and
 * that door was open.
 */
describe("an expired session", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("takes this tab's deck session with the token", async () => {
    window.localStorage.setItem("token", "a-token");
    window.sessionStorage.setItem(
      "lede.deck.v1",
      JSON.stringify({ v: 1, decisions: { 1: "saved" }, dealt: 12 })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false }), { status: 401 })
      )
    );

    await getDesk();

    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.sessionStorage.getItem("lede.deck.v1")).toBeNull();
  });
});
