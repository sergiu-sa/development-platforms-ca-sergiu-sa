/**
 * JWT Authentication Middleware
 * Protects routes that require authentication.
 * Expects: Authorization: Bearer <token>
 */

import { Context, Next } from "hono";
import jwt from "jsonwebtoken";

export interface JWTPayload {
  userId: number;
  email: string;
  iat?: number;
  exp?: number;
}

// Extend Hono's context to include user data
declare module "hono" {
  interface ContextVariableMap {
    user: JWTPayload;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        message: "Authentication required. Please provide a valid token.",
        hint: "Include header: Authorization: Bearer <your_token>",
      },
      401
    );
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error("JWT_SECRET is not defined in environment variables!");
    return c.json(
      {
        success: false,
        message: "Server configuration error",
      },
      500
    );
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
    c.set("user", decoded);
    await next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return c.json(
        {
          success: false,
          message: "Token has expired. Please login again.",
        },
        401
      );
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return c.json(
        {
          success: false,
          message: "Invalid token. Please login again.",
        },
        401
      );
    }

    return c.json(
      {
        success: false,
        message: "Authentication failed",
      },
      401
    );
  }
}
