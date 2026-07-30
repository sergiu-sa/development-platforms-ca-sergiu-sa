import { describe, it, expect } from "vitest";
import { safeNext } from "./api";

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
