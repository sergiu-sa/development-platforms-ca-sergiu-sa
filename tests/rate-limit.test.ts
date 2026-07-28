/**
 * Rate limiting on the authentication endpoints.
 *
 * Each test uses its own x-forwarded-for value so callers land in separate
 * buckets and cannot interfere with one another.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { app } from "../src/app.js";
import { createSchema, resetDatabase, closeDatabase } from "./helpers/db.js";
import { pool } from "../src/db/connection.js";

beforeAll(createSchema);
beforeEach(resetDatabase);
afterAll(closeDatabase);

async function loginFrom(
  ip: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, any>; retryAfter?: string }> {
  const response = await app.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    })
  );

  const text = await response.text();
  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return {
    status: response.status,
    body: parsed,
    retryAfter: response.headers.get("Retry-After") ?? undefined,
  };
}

const wrongCredentials = {
  email: "nobody@example.com",
  password: "wrongpassword",
};

describe("login rate limiting", () => {
  it("allows attempts up to the limit, then returns 429", async () => {
    const ip = "203.0.113.10";

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await loginFrom(ip, wrongCredentials);
      expect(response.status).toBe(401);
    }

    const blocked = await loginFrom(ip, wrongCredentials);

    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.message).toMatch(/too many/i);
  });

  it("sends Retry-After so a client knows when to come back", async () => {
    const ip = "203.0.113.11";

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await loginFrom(ip, wrongCredentials);
    }

    const blocked = await loginFrom(ip, wrongCredentials);

    expect(blocked.retryAfter).toBe("900");
  });

  it("keeps separate budgets per client", async () => {
    const attacker = "203.0.113.12";
    const bystander = "203.0.113.13";

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      await loginFrom(attacker, wrongCredentials);
    }

    const attackerBlocked = await loginFrom(attacker, wrongCredentials);
    const bystanderFine = await loginFrom(bystander, wrongCredentials);

    expect(attackerBlocked.status).toBe(429);
    // One person guessing must never lock everyone else out.
    expect(bystanderFine.status).toBe(401);
  });

  // A successful login must never count against the budget, or a user on a
  // shared address could be locked out by simply using the site.
  it("does not count successful logins", async () => {
    const ip = "203.0.113.14";

    await app.fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "regular@example.com",
          username: "regular",
          password: "password123",
        }),
      })
    );

    for (let attempt = 1; attempt <= 15; attempt += 1) {
      const response = await loginFrom(ip, {
        email: "regular@example.com",
        password: "password123",
      });
      expect(response.status).toBe(200);
    }

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM auth_attempts WHERE scope = 'auth:login'"
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("frees the budget once the window has passed", async () => {
    const ip = "203.0.113.15";

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      await loginFrom(ip, wrongCredentials);
    }

    expect((await loginFrom(ip, wrongCredentials)).status).toBe(429);

    // Age every recorded attempt past the 15-minute window.
    await pool.query(
      "UPDATE auth_attempts SET attempted_at = now() - interval '16 minutes'"
    );

    expect((await loginFrom(ip, wrongCredentials)).status).toBe(401);
  });

  it("prunes attempts that have aged out of the window", async () => {
    const ip = "203.0.113.16";

    await loginFrom(ip, wrongCredentials);
    await pool.query(
      "UPDATE auth_attempts SET attempted_at = now() - interval '2 hours'"
    );

    // The next check prunes expired rows on its way past, so the table stays
    // bounded without a scheduled job.
    await loginFrom(ip, wrongCredentials);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM auth_attempts"
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("keeps login and register on separate budgets", async () => {
    const ip = "203.0.113.17";

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      await loginFrom(ip, wrongCredentials);
    }

    expect((await loginFrom(ip, wrongCredentials)).status).toBe(429);

    const registration = await app.fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({
          email: "fresh@example.com",
          username: "freshuser",
          password: "password123",
        }),
      })
    );

    expect(registration.status).toBe(201);
  });
});
