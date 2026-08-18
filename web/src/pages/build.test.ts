// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The first test of a page entry, and the reason one exists now: nothing in `web/src/pages/` was covered, so a page that renders its shell and then stops for ever was invisible to a green suite.
 *
 * It drives the real module, the entry runs `mount()` on import - against a stubbed `fetch` rather than a mocked `lib/api`.
 * That is deliberate: the bug lived in the seam between the two, where `lib/api.ts` redirects on a 401 only when the request carried a token.
 * Mocking the api module would have stubbed out the very behaviour under test and passed against the broken page.
 */

/** The parts of `build.html` this page reads. */
function page(): void {
  document.body.innerHTML = `
    <a href="/login.html" id="nav-login" class="nav-link">Log in</a>
    <span id="nav-user" hidden></span>
    <button id="nav-logout" type="button" hidden>Log out</button>
    <main class="build" id="root"><p class="m quiet">Loading...</p></main>
    <div class="build-bar" id="build-bar" hidden></div>
  `;
}

/**
 * Replaces `window.location` with something that records a navigation instead of performing one, and answers the two fields the page reads.
 *
 * The same shape `lib/auth.test.ts` uses for logout.
 */
function stubLocation(pathname: string, search: string) {
  const assign = vi.fn();

  Object.defineProperty(window, "location", {
    value: {
      pathname,
      search,
      set href(url: string) {
        assign(url);
      },
    },
    writable: true,
    configurable: true,
  });

  return assign;
}

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

/** A token the page can decode. Never verified here; the API is the boundary. */
const token = (payload: Record<string, unknown>) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

/**
 * Imports the entry fresh.
 *
 * `resetModules` is what makes a second test run the module body again, the entry does its work at import time, so a cached module would mount nothing.
 */
async function openBuildPage(): Promise<void> {
  vi.resetModules();
  await import("./build");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  page();
});

describe("the builder, signed out", () => {
  /**
   * The bug this file was written for.
   *
   * `/api/desk/briefings` answers 401 to an anonymous caller, and the page read that as "the session expired, `lib/api.ts` has already sent them to sign in" and returned.
   * But that redirect only fires for a request that carried a token, so a signed-out visitor was never sent anywhere: the shell stayed on screen with "Loading..." under it, with no error in the console, for ever.
   */
  it("sends a signed-out visitor to sign in rather than leaving them on Loading", async () => {
    const assign = stubLocation("/build.html", "");
    vi.stubGlobal("fetch", answer(401, { success: false }));

    await openBuildPage();

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/login.html?next=%2Fbuild.html")
    );
  });

  /**
   * The other branch of the same page, and the reason the guard belongs in `mount()` rather than in the starter alone.
   *
   * Signing in has to land them back on the briefing they were opening, or the address they followed is lost the moment they authenticate.
   */
  it("carries the briefing being opened across the sign-in", async () => {
    const assign = stubLocation("/build.html", "?b=a-briefing-1a2b");
    vi.stubGlobal("fetch", answer(404, { success: false }));

    await openBuildPage();

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "/login.html?next=%2Fbuild.html%3Fb%3Da-briefing-1a2b"
      )
    );
  });

  /**
   * The guard must not become an open redirect on the way past.
   *
   * `safeNext` is what stops a hostile path being handed back to the sign-in form as somewhere to go afterwards;
   * this pins that it is actually applied here rather than only where phase 3 put it.
   */
  it("refuses to carry a path that would leave the site", async () => {
    const assign = stubLocation("/\\evil.com", "");
    vi.stubGlobal("fetch", answer(401, { success: false }));

    await openBuildPage();

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/login.html?next=%2F")
    );
  });
});

describe("the builder, signed in", () => {
  /**
   * The regression the guard could plausibly cause: bouncing somebody who is signed in perfectly well.
   * The starter has to draw for them as before.
   */
  it("leaves a signed-in curator on the page", async () => {
    localStorage.setItem("token", token({ userId: 1, username: "alice" }));
    const assign = stubLocation("/build.html", "");
    vi.stubGlobal("fetch", answer(200, { success: true, briefings: [] }));

    await openBuildPage();

    await vi.waitFor(() =>
      expect(document.getElementById("root")!.textContent).not.toContain(
        "Loading..."
      )
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
