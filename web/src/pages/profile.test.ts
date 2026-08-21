// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The curator page's entry.
 *
 * Same harness as `build.test.ts`, and the same reasoning: the real module against a stubbed `fetch` rather than a mocked `lib/api`, because the seam between those two is where a page entry goes wrong.
 *
 * This one has a case the builder does not, and it is the reason a public page needs its own test at all: `/u/:username` **must not** adopt the sign-in guard `desk.ts` and `build.ts` carry. Those pages are behind auth. This one has to work for a visitor who followed a byline out of a briefing and has no account, and a guard copied here would send them to a login form for reading somebody's public shelf.
 */

/** The parts of `u.html` this page reads. */
function page(inlined?: unknown): void {
  document.body.innerHTML =
    `<div id="root"><p class="m quiet">Loading this shelf...</p></div>` +
    (inlined
      ? `<script type="application/json" id="curator-data">${JSON.stringify(inlined)}</script>`
      : "");
}

function stubLocation(pathname: string, search = "") {
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

/**
 * A stubbed `fetch`.
 *
 * The parameters are declared even though the body ignores them, so the mock's recorded calls are typed and a test can assert which URL was asked for.
 */
function answer(status: number, body: unknown) {
  return vi.fn(
    async (..._args: unknown[]) =>
      new Response(JSON.stringify(body), { status })
  );
}

/** A token the page can decode.Never verified here; the API is the boundary. */
const token = (payload: Record<string, unknown>) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

function shelf(over: Record<string, unknown> = {}) {
  return {
    username: "sergiu",
    page: 1,
    pageSize: 20,
    total: 1,
    briefings: [
      {
        id: 1,
        slug: "the-heat-7f3a",
        title: "The heat, and who pays",
        intro: "Six stories about heat.",
        status: "published",
        publishedAt: "2026-08-01T17:20:00.000Z",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T17:20:00.000Z",
        author: { username: "sergiu" },
        itemCount: 3,
        ledeImageUrl: "https://media.guim.co.uk/abc/1000.jpg",
      },
    ],
    ...over,
  };
}

async function openProfile(): Promise<void> {
  vi.resetModules();
  await import("./profile");
  // The entry's own work is async;
  //  one turn of the queue is enough for the inlined path, and the fetch stubs resolve immediately.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("a curator's shelf", () => {
  it("renders from the inlined payload without asking again", async () => {
    // The server just read this to build the meta tags. Asking a second time would be paying twice for one answer.
    stubLocation("/u/sergiu");
    const fetchStub = answer(200, {});
    vi.stubGlobal("fetch", fetchStub);
    page(shelf());

    await openProfile();

    expect(document.body.innerHTML).toContain("The heat, and who pays");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("works signed out, and sends nobody to a login form", async () => {
    // The case this file exists for.
    // A public page that adopted the builder's guard would bounce a visitor for reading somebody's public shelf.
    const assign = stubLocation("/u/sergiu");
    vi.stubGlobal(
      "fetch",
      answer(200, {
        success: true,
        curator: { username: "sergiu" },
        ...shelf(),
      })
    );
    page();

    await openProfile();

    expect(assign).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toContain("The heat, and who pays");
  });

  it("falls back to fetching when the document carried nothing", async () => {
    stubLocation("/u/sergiu");
    const fetchStub = answer(200, {
      success: true,
      curator: { username: "sergiu" },
      ...shelf(),
    });
    vi.stubGlobal("fetch", fetchStub);
    page();

    await openProfile();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0][0])).toContain(
      "/api/curators/sergiu"
    );
  });

  it("reads the name out of the pretty path", async () => {
    stubLocation("/u/someone-else");
    const fetchStub = answer(404, { success: false });
    vi.stubGlobal("fetch", fetchStub);
    page();

    await openProfile();

    expect(String(fetchStub.mock.calls[0][0])).toContain(
      "/api/curators/someone-else"
    );
  });

  it("carries ?page= through to the request", async () => {
    stubLocation("/u/sergiu", "?page=3");
    const fetchStub = answer(200, {
      success: true,
      curator: { username: "sergiu" },
      ...shelf({ page: 3, total: 45 }),
    });
    vi.stubGlobal("fetch", fetchStub);
    page();

    await openProfile();

    expect(String(fetchStub.mock.calls[0][0])).toContain("page=3");
  });

  it("trusts an inlined null instead of asking the same question again", async () => {
    // The server looked the name up and found nobody, and said so in the document.
    // Asking again costs a second function invocation and a second database round trip on every mistyped or scanned /u/ address.
    stubLocation("/u/nobody");
    const fetchStub = answer(200, {});
    vi.stubGlobal("fetch", fetchStub);
    document.body.innerHTML =
      `<div id="root"></div>` +
      `<script type="application/json" id="curator-data">null</script>`;

    await openProfile();

    expect(document.body.innerHTML).toContain("No curator by that name");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("still asks when the document inlined nothing, because nothing was learned", async () => {
    // The read threw, or the name could not be a username.
    // The page must not report "nobody has that name" on the strength of a missing payload.
    stubLocation("/u/sergiu");
    const fetchStub = answer(404, { success: false });
    vi.stubGlobal("fetch", fetchStub);
    page();

    await openProfile();

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("does not hang on an address with a malformed percent escape", async () => {
    // `/u/%` is a legal thing to type, and decodeURIComponent throws URIError on it.
    // Unguarded that threw inside mount(), leaving the shell saying "Loading this shelf..." for ever;
    //  the failure shape the builder shipped once, which a green suite could not see.
    stubLocation("/u/%");
    const fetchStub = answer(404, { success: false });
    vi.stubGlobal("fetch", fetchStub);
    page();

    await openProfile();

    expect(document.body.innerHTML).toContain("No curator by that name");
    expect(document.body.innerHTML).not.toContain("Loading this shelf");
    // A name that cannot be decoded is never worth a request.
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("tells a missing curator apart from a failed connection", async () => {
    // Two different pages, not two wordings of one. A 404 here is designed.
    stubLocation("/u/nobody");
    vi.stubGlobal("fetch", answer(404, { success: false }));
    page();

    await openProfile();

    expect(document.body.innerHTML).toContain("No curator by that name");
  });

  it("does not go blank on a 200 that is not the shape it asked for", async () => {
    // The page does its work at import, so a throw here leaves a shell on screen and an unhandled rejection in the console;
    //  no error a reader can see.
    // Found by a stub that forgot a field, and worth keeping.
    stubLocation("/u/sergiu");
    vi.stubGlobal("fetch", answer(200, { success: true }));
    page();

    await openProfile();

    expect(document.body.innerHTML).toContain("did not load");
  });

  it("says the connection failed when nothing answered", async () => {
    stubLocation("/u/sergiu");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      })
    );
    page();

    await openProfile();

    expect(document.body.innerHTML).toContain("did not load");
    expect(document.body.innerHTML).not.toContain("No curator by that name");
  });
});

describe("the drafts band", () => {
  it("is not drawn for a visitor who is not the curator", async () => {
    stubLocation("/u/sergiu");
    localStorage.setItem("token", token({ username: "someone-else" }));
    const fetchStub = answer(200, {});
    vi.stubGlobal("fetch", fetchStub);
    page(shelf());

    await openProfile();

    expect(document.body.innerHTML).not.toContain("Only you can see these");
    // And their own drafts are never even asked for on somebody else's page.
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("is drawn on your own profile, counting drafts only", async () => {
    stubLocation("/u/sergiu");
    localStorage.setItem("token", token({ username: "sergiu" }));
    // The shelf says 1 published; the desk says 3 briefings in total.
    // The difference is the drafts, and it needs no row payload at all.
    vi.stubGlobal("fetch", answer(200, { success: true, total: 3 }));
    page(shelf());

    await openProfile();

    expect(document.body.innerHTML).toContain("2 drafts");
    expect(document.body.innerHTML).toContain("Only you can see these");
  });

  it("matches your name whatever case the address was typed in", async () => {
    // Usernames are unique case-insensitively, so /u/SERGIU is your own page.
    stubLocation("/u/SERGIU");
    localStorage.setItem("token", token({ username: "sergiu" }));
    vi.stubGlobal("fetch", answer(200, { success: true, total: 2 }));
    page(shelf());

    await openProfile();

    expect(document.body.innerHTML).toContain("1 draft");
  });

  it("counts drafts past the first page of the curator's own briefings", async () => {
    // The first version filtered the returned rows for status === "draft", and `listOwn` pages at twenty;
    //  so a curator whose drafts sat on page two was told they had none.
    // Subtracting the totals has no page in it.
    stubLocation("/u/sergiu");
    localStorage.setItem("token", token({ username: "sergiu" }));
    vi.stubGlobal("fetch", answer(200, { success: true, total: 25 }));
    page(shelf({ total: 20 }));

    await openProfile();

    expect(document.body.innerHTML).toContain("5 drafts");
  });

  it("shows no band rather than a negative count if a briefing is filed mid-load", async () => {
    // The two totals come from two requests.
    stubLocation("/u/sergiu");
    localStorage.setItem("token", token({ username: "sergiu" }));
    vi.stubGlobal("fetch", answer(200, { success: true, total: 0 }));
    page(shelf({ total: 1 }));

    await openProfile();

    expect(document.body.innerHTML).not.toContain("Only you can see these");
    expect(document.body.innerHTML).not.toContain("-1");
  });

  it("keeps a reader on the shelf when their own token has expired", async () => {
    // The band's request is a background probe on a page anybody may read.
    // Left to lib/api.ts's global handling, a 401 there reads as an ended session:
    //  localStorage cleared and the already-painted shelf replaced by a login form, on somebody else's public profile as readily as on your own.
    stubLocation("/u/sergiu");
    localStorage.setItem("token", token({ username: "sergiu" }));
    const assign = stubLocation("/u/sergiu");
    vi.stubGlobal("fetch", answer(401, { success: false }));
    page(shelf());

    await openProfile();

    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).not.toBeNull();
    expect(document.body.innerHTML).toContain("The heat, and who pays");
    expect(document.body.innerHTML).not.toContain("Only you can see these");
  });

  it("leaves the shelf alone when the draft count cannot be had", async () => {
    // Best effort by design: losing a private count must not turn a public page into an error.
    stubLocation("/u/sergiu");
    localStorage.setItem("token", token({ username: "sergiu" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      })
    );
    page(shelf());

    await openProfile();

    expect(document.body.innerHTML).toContain("The heat, and who pays");
    expect(document.body.innerHTML).not.toContain("Only you can see these");
  });
});
