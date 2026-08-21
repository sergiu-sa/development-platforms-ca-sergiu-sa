/**
 * The public paths that live outside `/api`, and the four places each one is written.
 *
 * `/b/:slug` and `/u/:username` are documents the server composes, and getting one of them onto a screen takes agreement between four things that cannot see each other:
 *
 *   - `vercel.json` rewrites the pretty path to the API path, which is what routes the request to the function at all
 *   - a route mounted at the root in `src/app.ts`, because `hono/vercel` rebuilds the request from the ORIGINAL url and the router therefore never sees the rewritten one
 *   - a Vite dev middleware, because Vite knows nothing about the rewrite and the path would 404 locally
 *   - a regex in the page's own entry, which reads the parameter back out of the address
 *
 * Three of those runtimes genuinely differ, so three hooks are correct. Three hand-written copies of the same *data* are not, and this is the loose end phase 9 opened when it discovered the second item on that list the expensive way: `/b/:slug` was live, correct, and answering Hono's own 404 on the only address readers use, with every local check passing.
 *
 * `tests/csp.test.ts` is the pattern. Same shape, same reason: something declared in more than one place, with nothing but a paragraph keeping the copies in step.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { app } from "../src/app.js";
import {
  PINNED,
  PRETTY_PATHS as VITE_PATHS,
  STYLESHEET,
} from "../vite.config.js";
import { buildBriefingPage } from "../src/modules/briefings/briefing-page.shell.js";
import { buildCuratorPage } from "../src/modules/briefings/curator-page.shell.js";

interface VercelConfig {
  rewrites?: { source: string; destination: string }[];
}

/**
 * Every pretty path this project serves, and what each one has to agree with.
 *
 * Adding a page here before wiring it is the point: the test fails until all four places exist, which is the opposite of the phase 9 failure where three of them did.
 */
const PRETTY_PATHS = [
  {
    prefix: "b",
    param: "slug",
    destination: "/api/briefings/:slug/page",
    entry: "/b.html",
    pageModule: "web/src/pages/briefing.ts",
  },
  {
    prefix: "u",
    param: "username",
    destination: "/api/curators/:username/page",
    entry: "/u.html",
    pageModule: "web/src/pages/profile.ts",
  },
];

interface VercelHeaders {
  headers?: { source: string }[];
}

const vercel = JSON.parse(
  readFileSync("vercel.json", "utf-8")
) as VercelConfig & VercelHeaders;

describe("pretty paths", () => {
  // If this list is ever emptied the checks below pass for nothing, which is the failure mode a glob-driven guard already had once in this repo.
  it("covers at least the two pages that have one", () => {
    expect(PRETTY_PATHS.length).toBeGreaterThanOrEqual(2);
  });

  for (const path of PRETTY_PATHS) {
    describe(`/${path.prefix}/:${path.param}`, () => {
      it("is rewritten to its API path by vercel.json", () => {
        const rewrite = (vercel.rewrites ?? []).find(
          (r) => r.source === `/${path.prefix}/:${path.param}`
        );

        expect(
          rewrite,
          `vercel.json has no rewrite for /${path.prefix}/:${path.param}. ` +
            "Without it the request never reaches the function at all."
        ).toBeDefined();
        expect(rewrite!.destination).toBe(path.destination);
      });

      it("is a real route on the app, not only a rewrite", () => {
        // The phase 9 lesson, and the one no other check in this suite can see.
        // hono/vercel rebuilds the request from the original url, so the router is asked for the PRETTY path and a rewrite alone leaves nothing mounted there.
        const mounted = app.routes.some(
          (route) =>
            route.method === "GET" &&
            new RegExp(`^/${path.prefix}/:[^/]+$`).test(route.path)
        );

        expect(
          mounted,
          `Nothing is mounted at /${path.prefix}/:${path.param} on the app. ` +
            "The vercel.json rewrite gets the request to the function and no " +
            "further: hono/vercel rebuilds it from the original url, so the " +
            "router sees the pretty path. The page would be live, correct, " +
            "and answering 404 on the only address anybody uses."
        ).toBe(true);
      });

      it("falls back to its entry in the Vite dev server", () => {
        // Imported rather than grepped for.
        // The first version searched the config's source text, which passes if the string appears in a comment and keeps passing if the middleware is reordered or its regex broken;
        // the weakest assertion in the one file whose whole job is catching drift.
        const known = VITE_PATHS.find((p) => p.prefix === path.prefix);

        expect(
          known,
          `vite.config.ts's PRETTY_PATHS has no entry for /${path.prefix}/. ` +
            "Without it the path 404s in development and the page can only be " +
            "opened as its .html file, which is not the address anybody tests."
        ).toBeDefined();
        expect(known!.entry).toBe(path.entry);
      });

      it("is read back out of the address by its own page entry", () => {
        const source = readFileSync(path.pageModule, "utf-8");

        expect(
          source.includes(`/^\\/${path.prefix}\\/([^/?#]+)/`),
          `${path.pageModule} does not read its parameter out of ` +
            `/${path.prefix}/... . The document carries the data inlined, but ` +
            "the fallback fetch and the pager both need the address parsed."
        ).toBe(true);
      });
    });
  }

  it("mounts no pretty path the list does not know about", () => {
    // Catches the other direction: a page added to the app without an entry here, which would then have no check that its other three copies exist.
    const known = PRETTY_PATHS.map((path) => path.prefix);

    const mounted = app.routes
      .filter((route) => route.method === "GET")
      .map((route) => /^\/([^/]+)\/:[^/]+$/.exec(route.path)?.[1])
      .filter((prefix): prefix is string => Boolean(prefix))
      .filter((prefix) => prefix !== "api");

    expect([...new Set(mounted)].sort()).toEqual([...known].sort());
  });
});

/**
 * The filenames the server writes into the documents it generates.
 *
 * The build guard in `vite.config.ts` proves the bundle *emits* `assets/profile.js`. Nothing proved the server *asks for* that same string, and the two are hand-written on opposite sides of a boundary no compiler crosses - `src/` never imports `vite.config.ts` in production, and the shells hold their script names as plain constants.
 *
 * So renaming one of them left every gate green: `pinnedAssets` checked its own constant against its own bundle, the page tests never mentioned a filename, and the failure was a deployed page whose `#root` said "Loading..." for ever. That is the shape of the `app.css` to `api.css` rename phase 9 already paid for, one layer up.
 */
describe("the assets a generated document names", () => {
  const documents = [
    {
      what: "the briefing page",
      html: buildBriefingPage({
        briefing: null,
        origin: "https://example.test",
        slug: "s",
      }),
      pinned: PINNED.briefing,
    },
    {
      what: "the curator page",
      html: buildCuratorPage({
        lookup: { state: "unavailable" },
        origin: "https://example.test",
      }),
      pinned: PINNED.profile,
    },
  ];

  for (const { what, html, pinned } of documents) {
    it(`${what} asks for the entry the build emits`, () => {
      expect(
        html,
        `${what}'s shell names a script the build does not emit under that ` +
          `name. The build writes "${pinned}"; rename one without the other ` +
          "and the page loads a 404 and never mounts."
      ).toContain(`src="/${pinned}"`);
    });

    it(`${what} asks for the stylesheet the build emits`, () => {
      expect(html).toContain(`href="/${STYLESHEET}"`);
    });
  }

  it("is cached by name in vercel.json, so no pinned asset goes stale", () => {
    // These carry no content hash, so the CDN needs an explicit revalidation rule for each or a redeploy would not be picked up.
    const rule = (vercel.headers ?? []).find((h) =>
      h.source.startsWith("/assets/(")
    );

    expect(
      rule,
      "vercel.json has no cache rule for the unhashed assets"
    ).toBeDefined();

    for (const name of [...Object.values(PINNED), STYLESHEET]) {
      expect(
        rule!.source,
        `vercel.json's asset cache rule does not list "${name}"`
      ).toContain(name.replace("assets/", ""));
    }
  });
});
