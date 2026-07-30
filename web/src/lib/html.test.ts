// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { escapeHtml, safeUrl } from "./html";

describe("escapeHtml", () => {
  it("escapes angle brackets and ampersands", () => {
    expect(escapeHtml("<b>Tom & Jerry</b>")).toBe(
      "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;"
    );
  });

  it("escapes quotes, because values land inside attributes", () => {
    expect(escapeHtml(`a "b" 'c'`)).toBe("a &quot;b&quot; &#39;c&#39;");
  });

  it("returns an empty string for null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("safeUrl", () => {
  it("allows http and https", () => {
    expect(safeUrl("https://theguardian.com/x")).toBe(
      "https://theguardian.com/x"
    );
  });

  it("rejects javascript: URLs, which are script execution", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBeNull();
  });

  it("rejects data: and protocol-relative URLs", () => {
    expect(safeUrl("data:text/html;base64,x")).toBeNull();
    expect(safeUrl("//evil.com")).toBeNull();
  });
});
