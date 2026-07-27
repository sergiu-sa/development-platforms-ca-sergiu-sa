import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { post } from "./helpers/request.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { config } from "../src/config/env.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

const validRegistration = {
  email: "new@example.com",
  username: "newcomer",
  password: "password123",
};

describe("POST /auth/register", () => {
  it("creates a user and returns its id", async () => {
    const response = await post("/auth/register", validRegistration);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.user.email).toBe("new@example.com");
    expect(response.body.user.username).toBe("newcomer");
    expect(typeof response.body.user.id).toBe("number");
  });

  it("never returns the password or its hash", async () => {
    const response = await post("/auth/register", validRegistration);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("password123");
    expect(serialised).not.toContain("password_hash");
  });

  it("rejects a duplicate email with 409", async () => {
    await post("/auth/register", validRegistration);

    const response = await post("/auth/register", {
      ...validRegistration,
      username: "someoneelse",
      password: "differentpassword",
    });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("rejects a duplicate username with 409", async () => {
    await post("/auth/register", validRegistration);

    const response = await post("/auth/register", {
      ...validRegistration,
      email: "different@example.com",
    });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/username/i);
  });

  // Usernames are bylines, so "Alice" must not be able to shadow "alice".
  it("rejects a username differing only by case", async () => {
    await post("/auth/register", validRegistration);

    const response = await post("/auth/register", {
      ...validRegistration,
      email: "different@example.com",
      username: "NewComer",
    });

    expect(response.status).toBe(409);
  });

  // MySQL's collation gave this for free. Postgres needs the LOWER() index,
  // and without it the same person could register twice.
  it("rejects an email differing only by case", async () => {
    await post("/auth/register", validRegistration);

    const response = await post("/auth/register", {
      ...validRegistration,
      email: "NEW@example.com",
      username: "someoneelse",
    });

    expect(response.status).toBe(409);
  });

  it("rejects a malformed email", async () => {
    const response = await post("/auth/register", {
      ...validRegistration,
      email: "not-an-email",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a password shorter than 6 characters", async () => {
    const response = await post("/auth/register", {
      ...validRegistration,
      password: "12345",
    });

    expect(response.status).toBe(400);
  });

  it.each([
    ["too short", "ab"],
    ["too long", "a".repeat(31)],
    ["containing spaces", "two words"],
    ["containing markup", "<script>"],
    ["containing an at sign", "looks@email.com"],
  ])("rejects a username %s", async (_label, username) => {
    const response = await post("/auth/register", {
      ...validRegistration,
      username,
    });

    expect(response.status).toBe(400);
  });

  it("rejects a request with missing fields", async () => {
    const response = await post("/auth/register", {});

    expect(response.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await post("/auth/register", {
      email: "user@example.com",
      username: "regular",
      password: "password123",
    });
  });

  it("returns a token signed with the configured secret", async () => {
    const response = await post("/auth/login", {
      email: "user@example.com",
      password: "password123",
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const payload = jwt.verify(response.body.token, config.jwtSecret) as {
      userId: number;
      email: string;
      username: string;
    };

    expect(payload.email).toBe("user@example.com");
    expect(payload.username).toBe("regular");
    expect(typeof payload.userId).toBe("number");
  });

  it("logs in regardless of email casing", async () => {
    const response = await post("/auth/login", {
      email: "USER@example.com",
      password: "password123",
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  it("rejects a wrong password with 401", async () => {
    const response = await post("/auth/login", {
      email: "user@example.com",
      password: "wrongpassword",
    });

    expect(response.status).toBe(401);
    expect(response.body.token).toBeUndefined();
  });

  // Both failure modes must be indistinguishable, otherwise the endpoint
  // becomes an oracle for which email addresses are registered.
  it("gives an identical response for unknown email and wrong password", async () => {
    const wrongPassword = await post("/auth/login", {
      email: "user@example.com",
      password: "wrongpassword",
    });

    const unknownEmail = await post("/auth/login", {
      email: "nobody@example.com",
      password: "password123",
    });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });
});
