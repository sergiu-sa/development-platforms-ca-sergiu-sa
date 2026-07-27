import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { post } from "./helpers/request.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { config } from "../src/config/env.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("POST /auth/register", () => {
  it("creates a user and returns its id", async () => {
    const response = await post("/auth/register", {
      email: "new@example.com",
      password: "password123",
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.user.email).toBe("new@example.com");
    expect(typeof response.body.user.id).toBe("number");
  });

  it("never returns the password or its hash", async () => {
    const response = await post("/auth/register", {
      email: "new@example.com",
      password: "password123",
    });

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("password123");
    expect(serialised).not.toContain("password_hash");
  });

  it("rejects a duplicate email with 409", async () => {
    await post("/auth/register", {
      email: "taken@example.com",
      password: "password123",
    });

    const response = await post("/auth/register", {
      email: "taken@example.com",
      password: "differentpassword",
    });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("rejects a malformed email", async () => {
    const response = await post("/auth/register", {
      email: "not-an-email",
      password: "password123",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a password shorter than 6 characters", async () => {
    const response = await post("/auth/register", {
      email: "short@example.com",
      password: "12345",
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
    };

    expect(payload.email).toBe("user@example.com");
    expect(typeof payload.userId).toBe("number");
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
