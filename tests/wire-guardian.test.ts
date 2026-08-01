/**
 * Guardian client tests.
 *
 * Every case passes an explicit fetchImpl, so nothing here can reach the live
 * API even by accident. The Guardian allows 500 requests a day and CI runs on
 * every push.
 */

import { describe, it, expect } from "vitest";
import {
  fetchGuardianStories,
  resolveTone,
  selectImage,
} from "../src/modules/wire/wire.guardian.js";

function guardianResponse(
  results: unknown[],
  init: { remaining?: string } = {}
): Response {
  return new Response(JSON.stringify({ response: { status: "ok", results } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.remaining
        ? { "x-ratelimit-remaining-day": init.remaining }
        : {}),
    },
  });
}

/** One entry of an element's assets array, as the API reports it. */
function imageAsset(
  width: string,
  typeData: Record<string, unknown> = {}
): unknown {
  return {
    type: "image",
    mimeType: "image/jpeg",
    file: `https://media.guim.co.uk/abc/0_0_5000_4000/${width}.jpg`,
    // Guardian reports widths as strings, not numbers.
    typeData: { width, ...typeData },
  };
}

function mainImageElement(assets: unknown[]): unknown {
  return { id: "main-image", relation: "main", type: "image", assets };
}

function toneTags(...ids: string[]): unknown[] {
  return ids.map((id) => ({ id, type: "tone", webTitle: id }));
}

const sampleResult = {
  id: "world/2026/jul/28/example-story",
  // webTitle is deliberately different from fields.headline so the mapping
  // test proves which one wins.
  webTitle: "Web title",
  webUrl: "https://www.theguardian.com/world/2026/jul/28/example-story",
  sectionName: "World news",
  pillarName: "News",
  webPublicationDate: "2026-07-28T17:57:32Z",
  tags: toneTags("tone/features"),
  elements: [
    mainImageElement([
      imageAsset("1000", {
        altText: "Alt text for the photograph",
        credit: "Photograph: A Name/Reuters",
      }),
    ]),
  ],
  fields: {
    headline: "Headline from fields",
    trailText: "Trail text",
    standfirst: "Standfirst text",
    byline: "Sam Jones in Madrid",
    wordcount: "1066",
    starRating: "4",
    thumbnail: "https://media.guim.co.uk/abc/0_0_5000_4000/500.jpg",
  },
};

/** Fetches through the stub and returns the mapped stories. */
async function mapResults(results: unknown[]) {
  const { stories } = await fetchGuardianStories({
    apiKey: "k",
    fetchImpl: async () => guardianResponse(results),
  });

  return stories;
}

describe("resolveTone", () => {
  // A live blog arrives tagged both minutebyminute and news, so precedence is
  // the common path rather than an edge case.
  it("prefers minute-by-minute over news", () => {
    expect(resolveTone(toneTags("tone/news", "tone/minutebyminute"))).toBe(
      "minutebyminute"
    );
  });

  it("prefers reviews over comment", () => {
    expect(resolveTone(toneTags("tone/comment", "tone/reviews"))).toBe(
      "reviews"
    );
  });

  it("prefers comment over features", () => {
    expect(resolveTone(toneTags("tone/features", "tone/comment"))).toBe(
      "comment"
    );
  });

  it("is not decided by the order the tags arrive in", () => {
    expect(resolveTone(toneTags("tone/minutebyminute", "tone/reviews"))).toBe(
      "minutebyminute"
    );
    expect(resolveTone(toneTags("tone/reviews", "tone/minutebyminute"))).toBe(
      "minutebyminute"
    );
  });

  it("falls back to news for a tone with no card", () => {
    expect(resolveTone(toneTags("tone/obituaries"))).toBe("news");
  });

  it("falls back to news when there are no tone tags at all", () => {
    expect(resolveTone([])).toBe("news");
    expect(resolveTone(undefined)).toBe("news");
    expect(resolveTone(toneTags("type/article"))).toBe("news");
  });
});

describe("selectImage", () => {
  it("picks the wide asset regardless of its position in the array", () => {
    const image = selectImage(
      [
        mainImageElement([
          imageAsset("140"),
          imageAsset("500"),
          imageAsset("1000"),
        ]),
      ],
      null
    );

    expect(image?.url).toBe(
      "https://media.guim.co.uk/abc/0_0_5000_4000/1000.jpg"
    );
  });

  it("takes alt text and credit from the asset", () => {
    const image = selectImage(
      [
        mainImageElement([
          imageAsset("1000", {
            altText: "A jockey riding at full gallop",
            credit: "Photograph: Andrew Matthews/PA",
          }),
        ]),
      ],
      null
    );

    expect(image?.alt).toBe("A jockey riding at full gallop");
    expect(image?.credit).toBe("Photograph: Andrew Matthews/PA");
  });

  it("prefers the secure file over the plain one", () => {
    const image = selectImage(
      [
        mainImageElement([
          {
            file: "http://media.guim.co.uk/abc/insecure/1000.jpg",
            typeData: {
              width: "1000",
              secureFile: "https://media.guim.co.uk/abc/secure/1000.jpg",
            },
          },
        ]),
      ],
      null
    );

    expect(image?.url).toBe("https://media.guim.co.uk/abc/secure/1000.jpg");
  });

  it("ignores elements that are not the main image", () => {
    const image = selectImage(
      [
        { relation: "thumbnail", type: "image", assets: [imageAsset("1000")] },
        { relation: "body", type: "image", assets: [imageAsset("1000")] },
      ],
      "https://media.guim.co.uk/xyz/crop/500.jpg"
    );

    // Fell through to the thumbnail rather than using a body image.
    expect(image?.url).toBe("https://media.guim.co.uk/xyz/crop/1000.jpg");
  });

  it("widens the thumbnail when there is no wide asset", () => {
    const image = selectImage(
      [mainImageElement([imageAsset("500")])],
      "https://media.guim.co.uk/xyz/crop/500.jpg"
    );

    expect(image).toEqual({
      url: "https://media.guim.co.uk/xyz/crop/1000.jpg",
      // Only the asset carries these, so the fallback path has neither.
      alt: null,
      credit: null,
    });
  });

  it("keeps a thumbnail that is already the wide size", () => {
    const image = selectImage(
      null,
      "https://media.guim.co.uk/xyz/crop/1000.jpg"
    );

    expect(image?.url).toBe("https://media.guim.co.uk/xyz/crop/1000.jpg");
  });

  it("returns null when there is no image and no thumbnail", () => {
    expect(selectImage(undefined, null)).toBeNull();
    expect(selectImage([], null)).toBeNull();
  });

  it("returns null for a thumbnail that is not a width-suffixed path", () => {
    expect(selectImage([], "https://example.com/picture")).toBeNull();
  });
});

describe("fetchGuardianStories", () => {
  it("maps a Guardian result onto the stories shape", async () => {
    const stories = await mapResults([sampleResult]);

    // Every field carries a distinct value, so a mapping that crosses two of
    // them fails here rather than shipping.
    expect(stories).toEqual([
      {
        externalId: "world/2026/jul/28/example-story",
        title: "Headline from fields",
        summary: "Trail text",
        standfirst: "Standfirst text",
        byline: "Sam Jones in Madrid",
        url: "https://www.theguardian.com/world/2026/jul/28/example-story",
        section: "World news",
        pillar: "News",
        tone: "features",
        wordCount: 1066,
        starRating: 4,
        thumbnailUrl: "https://media.guim.co.uk/abc/0_0_5000_4000/500.jpg",
        imageUrl: "https://media.guim.co.uk/abc/0_0_5000_4000/1000.jpg",
        imageAlt: "Alt text for the photograph",
        imageCredit: "Photograph: A Name/Reuters",
        publishedAt: "2026-07-28T17:57:32Z",
      },
    ]);
  });

  it("falls back to webTitle when there is no headline field", async () => {
    const stories = await mapResults([
      { ...sampleResult, fields: { ...sampleResult.fields, headline: null } },
    ]);

    expect(stories[0].title).toBe("Web title");
  });

  it("sends the key and everything the stories table needs", async () => {
    let requested = "";

    await fetchGuardianStories({
      apiKey: "secret-key",
      fetchImpl: async (input) => {
        requested = String(input);
        return guardianResponse([]);
      },
    });

    const url = new URL(requested);
    expect(url.origin + url.pathname).toBe(
      "https://content.guardianapis.com/search"
    );
    expect(url.searchParams.get("api-key")).toBe("secret-key");
    expect(url.searchParams.get("show-fields")).toBe(
      "headline,trailText,standfirst,byline,wordcount,starRating,thumbnail"
    );
    expect(url.searchParams.get("show-tags")).toBe("tone");
    expect(url.searchParams.get("show-elements")).toBe("image");
    expect(url.searchParams.get("order-by")).toBe("newest");
  });

  // The frontend escapes everything it renders, so markup left in place would
  // put a literal "<strong>" on screen rather than bold text.
  it("strips HTML and decodes entities out of the summary", async () => {
    const stories = await mapResults([
      {
        ...sampleResult,
        fields: {
          ...sampleResult.fields,
          trailText: "<strong>Fish &amp; chips</strong> &lt;here&gt;",
        },
      },
    ]);

    expect(stories[0].summary).toBe("Fish & chips <here>");
  });

  // standfirst arrives as HTML exactly as trailText does.
  it("strips HTML out of the standfirst", async () => {
    const stories = await mapResults([
      {
        ...sampleResult,
        fields: {
          ...sampleResult.fields,
          standfirst: "<p>Updates from <b>Goodwood</b> &amp; beyond</p>",
        },
      },
    ]);

    expect(stories[0].standfirst).toBe("Updates from Goodwood & beyond");
  });

  // Caught on a real request: a standfirst of two paragraphs stripped to
  // "...around GlasgowMedal table | How...", welding two sentences together.
  it("keeps a word boundary where a block element ended", async () => {
    const stories = await mapResults([
      {
        ...sampleResult,
        fields: {
          ...sampleResult.fields,
          standfirst:
            "<p>Updates from around Glasgow</p><p>Medal table | How it went</p>",
          trailText: "First line<br>Second line",
        },
      },
    ]);

    expect(stories[0].standfirst).toBe(
      "Updates from around Glasgow Medal table | How it went"
    );
    expect(stories[0].summary).toBe("First line Second line");
  });

  it("treats markup that strips to nothing as absent", async () => {
    const stories = await mapResults([
      {
        ...sampleResult,
        fields: { ...sampleResult.fields, standfirst: "<p></p>" },
      },
    ]);

    expect(stories[0].standfirst).toBeNull();
  });

  it("defaults missing optional fields to null", async () => {
    const stories = await mapResults([
      {
        id: "x/1",
        webTitle: "Bare minimum",
        webUrl: "https://example.com/1",
        webPublicationDate: "2026-07-28T00:00:00Z",
        // Only a thumbnail, so the story still has an image to render.
        fields: { thumbnail: "https://media.guim.co.uk/x/crop/500.jpg" },
      },
    ]);

    expect(stories[0]).toMatchObject({
      summary: null,
      standfirst: null,
      byline: null,
      section: null,
      pillar: null,
      wordCount: null,
      starRating: null,
      imageAlt: null,
      imageCredit: null,
      // The default card, so nothing downstream has to handle a missing tone.
      tone: "news",
    });
  });

  it("parses the word count out of the string the API sends", async () => {
    const stories = await mapResults([
      {
        ...sampleResult,
        fields: { ...sampleResult.fields, wordcount: "2853" },
      },
    ]);

    expect(stories[0].wordCount).toBe(2853);
  });

  it("rejects a word count that is not a whole number", async () => {
    for (const wordcount of ["", " ", "many", "1.5", "-4"]) {
      const stories = await mapResults([
        { ...sampleResult, fields: { ...sampleResult.fields, wordcount } },
      ]);

      expect(stories[0].wordCount).toBeNull();
    }
  });

  // Every review in the sampled wire arrived without a rating, so this is the
  // normal case rather than a defensive one.
  it("keeps a review with no star rating", async () => {
    const stories = await mapResults([
      {
        ...sampleResult,
        tags: toneTags("tone/reviews"),
        fields: { ...sampleResult.fields, starRating: null },
      },
    ]);

    expect(stories[0].tone).toBe("reviews");
    expect(stories[0].starRating).toBeNull();
  });

  it("rejects a star rating outside 0-5", async () => {
    const stories = await mapResults([
      { ...sampleResult, fields: { ...sampleResult.fields, starRating: "9" } },
    ]);

    expect(stories[0].starRating).toBeNull();
  });

  it("drops results missing a field the schema requires", async () => {
    const stories = await mapResults([
      sampleResult,
      { id: "x/2", webTitle: "No url" },
    ]);

    expect(stories).toHaveLength(1);
  });

  // The deck renders a photograph at full size, so a story with no image has
  // no card to be drawn into.
  it("drops a result with neither a wide asset nor a thumbnail", async () => {
    const stories = await mapResults([
      sampleResult,
      {
        id: "x/3",
        webTitle: "No picture anywhere",
        webUrl: "https://example.com/3",
        webPublicationDate: "2026-07-28T00:00:00Z",
        elements: [],
        fields: {},
      },
    ]);

    expect(stories).toHaveLength(1);
    expect(stories[0].externalId).toBe(sampleResult.id);
  });

  it("reports the remaining daily rate limit", async () => {
    const { rateLimitRemaining } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () => guardianResponse([], { remaining: "498" }),
    });

    expect(rateLimitRemaining).toBe(498);
  });

  it("reports a null rate limit when the header is absent", async () => {
    const { rateLimitRemaining } = await fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () => guardianResponse([]),
    });

    expect(rateLimitRemaining).toBeNull();
  });

  it("throws on a non-2xx response without leaking the key", async () => {
    let thrown: unknown;

    try {
      await fetchGuardianStories({
        apiKey: "secret-key",
        fetchImpl: async () => new Response("nope", { status: 429 }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("429");
    // The key rides in the query string, so it must never reach a message that
    // ends up in a log.
    expect((thrown as Error).message).not.toContain("secret-key");
  });

  it("throws when the payload status is not ok", async () => {
    const attempt = fetchGuardianStories({
      apiKey: "k",
      fetchImpl: async () =>
        new Response(JSON.stringify({ response: { status: "error" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(attempt).rejects.toThrow(/status/i);
  });
});
