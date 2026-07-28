/**
 * authMiddleware tests.
 *
 * The middleware guards no route yet, but every briefings write will depend on
 * it, and ownership decisions are made from the payload it puts on the context.
 * Testing it before building on it means a regression surfaces here rather than
 * as an authorization hole three features later.
 *
 * A throwaway Hono app is used rather than a real route, so these stay valid
 * regardless of which endpoints end up protected.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import jwt from "jsonwebtoken";
import { authMiddleware } from "../src/middleware/auth.js";
import { config } from "../src/config/env.js";

const guarded = new Hono();

guarded.get("/protected", authMiddleware, (c) => {
  const user = c.get("user");
  return c.json({ success: true, user });
});

async function callWith(
  authorization?: string
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await guarded.fetch(
    new Request("http://localhost/protected", {
      headers: authorization ? { Authorization: authorization } : {},
    })
  );

  return { status: response.status, body: await response.json() };
}

function signedToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
  secret: string = config.jwtSecret
): string {
  return jwt.sign(payload, secret, options);
}

const validPayload = {
  userId: 42,
  email: "curator@example.com",
  username: "curator",
};

describe("authMiddleware", () => {
  it("puts the verified payload on the context", async () => {
    const response = await callWith(
      `Bearer ${signedToken(validPayload, { expiresIn: "1h" })}`
    );

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject(validPayload);
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await callWith();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("rejects a header that is not a Bearer scheme", async () => {
    const response = await callWith(
      `Basic ${Buffer.from("user:pass").toString("base64")}`
    );

    expect(response.status).toBe(401);
  });

  it("rejects a Bearer header with no token", async () => {
    const response = await callWith("Bearer ");

    expect(response.status).toBe(401);
  });

  it("rejects a token that is not a JWT at all", async () => {
    const response = await callWith("Bearer not-a-real-token");

    expect(response.status).toBe(401);
  });

  // Anyone can mint a JWT; only the signature proves it came from this server.
  it("rejects a token signed with a different secret", async () => {
    const forged = signedToken(
      validPayload,
      { expiresIn: "1h" },
      "an-attackers-own-secret"
    );

    const response = await callWith(`Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it("rejects an expired token and says so", async () => {
    const expired = signedToken(validPayload, { expiresIn: "-1s" });

    const response = await callWith(`Bearer ${expired}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/expired/i);
  });

  // The classic JWT forgery: strip the signature and claim the algorithm is
  // "none". jsonwebtoken refuses this when a secret is supplied, but it must be
  // proven rather than assumed.
  it("rejects an unsigned alg=none token", async () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");

    const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;

    const response = await callWith(`Bearer ${unsigned}`);

    expect(response.status).toBe(401);
  });

  it("rejects a token whose payload has been tampered with", async () => {
    const token = signedToken(validPayload, { expiresIn: "1h" });
    const [header, , signature] = token.split(".");

    const tampered = [
      header,
      Buffer.from(JSON.stringify({ ...validPayload, userId: 1 })).toString(
        "base64url"
      ),
      signature,
    ].join(".");

    const response = await callWith(`Bearer ${tampered}`);

    expect(response.status).toBe(401);
  });

  it("never leaks the signing secret in a failure response", async () => {
    const response = await callWith("Bearer not-a-real-token");

    expect(JSON.stringify(response.body)).not.toContain(config.jwtSecret);
  });
});
