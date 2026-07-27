import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { get, post, registerAndLogin } from "./helpers/request.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { config } from "../src/config/env.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

const validArticle = {
  title: "A Perfectly Ordinary Headline",
  body: "Body copy long enough to clear the ten character minimum.",
  category: "Tech",
};

describe("GET /articles", () => {
  it("is public and needs no token", async () => {
    const response = await get("/articles");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.articles).toEqual([]);
    expect(response.body.count).toBe(0);
  });

  it("returns created articles with their author", async () => {
    const { token } = await registerAndLogin("author@example.com");
    await post("/articles", validArticle, token);

    const response = await get("/articles");

    expect(response.body.count).toBe(1);
    expect(response.body.articles[0].title).toBe(validArticle.title);
    expect(response.body.articles[0].author_email).toBe("author@example.com");
  });

  it("orders newest first", async () => {
    const { token } = await registerAndLogin("author@example.com");

    await post("/articles", { ...validArticle, title: "Older Story" }, token);
    await post("/articles", { ...validArticle, title: "Newer Story" }, token);

    const response = await get("/articles");
    const ids = response.body.articles.map((a: { id: number }) => a.id);

    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});

describe("POST /articles", () => {
  it("rejects a request with no token", async () => {
    const response = await post("/articles", validArticle);

    expect(response.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const response = await post("/articles", validArticle, "not-a-jwt");

    expect(response.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign(
      { userId: 1, email: "attacker@example.com" },
      "the-wrong-secret"
    );

    const response = await post("/articles", validArticle, forged);

    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign(
      { userId: 1, email: "user@example.com" },
      config.jwtSecret,
      { expiresIn: "-1s" }
    );

    const response = await post("/articles", validArticle, expired);

    expect(response.status).toBe(401);
  });

  it("creates an article with a valid token", async () => {
    const { token } = await registerAndLogin("author@example.com");

    const response = await post("/articles", validArticle, token);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.article.title).toBe(validArticle.title);
  });

  // The whole anti-impersonation guarantee: authorship comes from the verified
  // token, never from client-supplied input.
  it("takes submitted_by from the token and ignores the request body", async () => {
    const victim = await registerAndLogin("victim@example.com");
    const attacker = await registerAndLogin("attacker@example.com");

    const response = await post(
      "/articles",
      { ...validArticle, submitted_by: victim.userId },
      attacker.token
    );

    expect(response.status).toBe(201);
    expect(response.body.article.submitted_by).toBe(attacker.userId);
    expect(response.body.article.submitted_by).not.toBe(victim.userId);
  });

  it.each([
    ["a title under 3 characters", { ...validArticle, title: "ab" }],
    ["a body under 10 characters", { ...validArticle, body: "too short" }],
    [
      "a category outside the allowed list",
      { ...validArticle, category: "Gossip" },
    ],
    ["missing fields", {}],
  ])("rejects %s", async (_label, payload) => {
    const { token } = await registerAndLogin("author@example.com");

    const response = await post("/articles", payload, token);

    expect(response.status).toBe(400);
  });
});

describe("GET /health", () => {
  it("reports the database as connected", async () => {
    const response = await get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("healthy");
    expect(response.body.database).toBe("connected");
  });
});
