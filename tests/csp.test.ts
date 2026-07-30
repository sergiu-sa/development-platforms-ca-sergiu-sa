/**
 * Content-Security-Policy drift tests.
 *
 * The policy is declared twice and has to stay identical in both places:
 *
 *   - src/app.ts, via secureHeaders(), covers API responses
 *   - vercel.json, under headers, covers everything the CDN serves
 *
 * The duplication is not an accident. Static responses never pass through Hono
 * in production, so the HTML - the one response that most needs a CSP - would
 * silently lose every security header if vercel.json did not carry its own
 * copy. That has already happened once in this project.
 *
 * Until now the only thing keeping the two in step was a paragraph in
 * CLAUDE.md. The frontend rebuild had to edit both, which is precisely the
 * situation where a one-sided edit slips through: the API keeps its tightened
 * policy, the CDN keeps serving the old permissive one, and nothing fails.
 *
 * No database is required. secureHeaders() is applied to "*" before any route,
 * so an unmatched path returns 404 with the headers already attached.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { app } from "../src/app.js";

interface VercelHeaderEntry {
  key: string;
  value: string;
}

interface VercelConfig {
  headers?: { source: string; headers: VercelHeaderEntry[] }[];
}

function cspFromVercelJson(): string {
  const config = JSON.parse(
    readFileSync("vercel.json", "utf-8")
  ) as VercelConfig;

  const entries = (config.headers ?? []).flatMap((h) => h.headers);
  const csp = entries.find(
    (h) => h.key.toLowerCase() === "content-security-policy"
  );

  if (!csp) {
    throw new Error(
      "vercel.json declares no Content-Security-Policy header. Static HTML is " +
        "served by the CDN and never passes through Hono, so without this " +
        "entry the pages ship with no policy at all."
    );
  }

  return csp.value;
}

async function cspFromApp(): Promise<string> {
  const response = await app.request("/api/__csp_probe__");
  const csp = response.headers.get("content-security-policy");

  if (!csp) {
    throw new Error(
      "src/app.ts returned no Content-Security-Policy header. secureHeaders() " +
        "should be applied to '*' before every route."
    );
  }

  return csp;
}

/** "a 'b'; c 'd'" -> { a: "a 'b'", c: "c 'd'" } */
function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(/\s+/)[0].toLowerCase(), d])
  );
}

describe("Content-Security-Policy", () => {
  it("is identical in src/app.ts and vercel.json", async () => {
    expect(await cspFromApp()).toBe(cspFromVercelJson());
  });

  // A whole-string comparison says "these differ" and leaves you diffing two
  // 300-character strings by eye. This names the directive.
  it("has no directive that differs between the two declarations", async () => {
    const fromApp = directives(await cspFromApp());
    const fromVercel = directives(cspFromVercelJson());

    const mismatched = [...new Set([...fromApp.keys(), ...fromVercel.keys()])]
      .filter((name) => fromApp.get(name) !== fromVercel.get(name))
      .map(
        (name) =>
          `${name}\n    app.ts:      ${fromApp.get(name) ?? "(absent)"}\n    vercel.json: ${fromVercel.get(name) ?? "(absent)"}`
      );

    expect(
      mismatched,
      "These CSP directives differ between src/app.ts and vercel.json. " +
        "Both must change together:\n  " +
        mismatched.join("\n  ")
    ).toEqual([]);
  });

  // The reason the CDN was dropped. If either of these comes back, the Vite
  // build has been undermined and script injection is materially easier.
  it("allows no script source beyond 'self' in either declaration", async () => {
    for (const [origin, policy] of [
      ["src/app.ts", await cspFromApp()],
      ["vercel.json", cspFromVercelJson()],
    ]) {
      const scriptSrc = directives(policy).get("script-src");
      expect(scriptSrc, `${origin} declares no script-src`).toBeDefined();
      expect(scriptSrc, `${origin} script-src`).toBe("script-src 'self'");
    }
  });
});
