/**
 * JWT Authentication Middleware
 * Protects routes that require authentication.
 * Expects: Authorization: Bearer <token>
 */

import { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

export interface JWTPayload {
  userId: number;
  email: string;
  username: string;
  iat?: number;
  exp?: number;
}

// Extend Hono's context to include user data
declare module "hono" {
  interface ContextVariableMap {
    /**
     * Optional, and that is not pedantry.
     *
     * `optionalAuth` leaves this unset for an anonymous caller, so a handler on a public route that writes `c.get("user").userId` is a runtime TypeError on every request without a token.
     * Declared non-optional, the compiler would wave that through.
     * Handlers behind `authMiddleware` know it is there and say so with `!`, which is a local claim a reader can check against the route it sits on.
     */
    user?: JWTPayload;
  }
}

/**
 * What reading the Authorization header produced.
 *
 * The cases are separated rather than collapsed into a boolean because the two middlewares below want different things from them:
 * one turns each into its own 401 message, the other treats everything that is not `ok` as "no reader is signed in".
 */
type BearerResult =
  | { status: "absent" }
  | { status: "ok"; payload: JWTPayload }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "misconfigured" };

function readBearer(c: Context): BearerResult {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { status: "absent" };
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = config.jwtSecret;

  if (!jwtSecret) {
    console.error("JWT_SECRET is not defined in environment variables!");
    return { status: "misconfigured" };
  }

  try {
    return {
      status: "ok",
      payload: jwt.verify(token, jwtSecret) as JWTPayload,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { status: "expired" };
    }

    return { status: "invalid" };
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const bearer = readBearer(c);

  switch (bearer.status) {
    case "ok":
      c.set("user", bearer.payload);
      return next();

    case "absent":
      return c.json(
        {
          success: false,
          message: "Authentication required. Please provide a valid token.",
          hint: "Include header: Authorization: Bearer <your_token>",
        },
        401
      );

    case "misconfigured":
      return c.json(
        { success: false, message: "Server configuration error" },
        500
      );

    case "expired":
      return c.json(
        { success: false, message: "Token has expired. Please login again." },
        401
      );

    case "invalid":
      return c.json(
        { success: false, message: "Invalid token. Please login again." },
        401
      );

    default: {
      // BearerResult is the whole point of this switch, so a variant added later must not fall quietly into "Invalid token".
      // This assignment stops compiling the moment one does.
      const unhandled: never = bearer;
      throw new Error(`Unhandled bearer result: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Reads a token if one is offered and carries on either way.
 *
 * For a route that is public but reads differently to the person who owns the thing:
 * a briefing's own author sees it while it is still a draft, and everyone else is told it does not exist.
 *
 * A token that fails to verify is treated as no token at all rather than as a 401.
 * This runs on public pages, and bouncing a reader off a published briefing because a week-old session expired would be the wrong trade;
 * the worst it costs them is seeing the page as a stranger would.
 *
 * Anything behind this must still decide for itself what an anonymous caller may see.
 * It grants nothing on its own, which is why it is safe to put on a public route and why it is never a substitute for authMiddleware.
 */
export async function optionalAuth(c: Context, next: Next) {
  const bearer = readBearer(c);

  if (bearer.status === "ok") {
    c.set("user", bearer.payload);
  }

  return next();
}

/** The signed-in reader, or null when nobody is. */
export function viewerId(c: Context): number | null {
  return c.get("user")?.userId ?? null;
}
