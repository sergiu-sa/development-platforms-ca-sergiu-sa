/**
 * Authentication Routes
 * POST /auth/register - Create a new user account
 * POST /auth/login    - Login and get a JWT token
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../../db/connection.js";
import { config } from "../../config/env.js";
import { registerSchema, loginSchema } from "./auth.schema.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const authRoutes = new Hono();

// Both endpoints are unauthenticated and guess-able, so they are the natural
// target for credential stuffing. Login gets the tighter budget; register is
// looser because a person filling in a form can legitimately trip validation
// several times.
const loginRateLimit = rateLimit({
  scope: "auth:login",
  limit: 10,
  windowMinutes: 15,
});

const registerRateLimit = rateLimit({
  scope: "auth:register",
  limit: 20,
  windowMinutes: 60,
});

// POST /auth/register - Create new user account
authRoutes.post(
  "/register",
  registerRateLimit,
  zValidator("json", registerSchema),
  async (c) => {
    try {
      const { email, username, password } = c.req.valid("json");

      // Check whether either identifier is taken. Usernames are compared
      // case-insensitively so "Alice" cannot shadow "alice" on article bylines.
      const { rows: existingUsers } = await pool.query<{
        email: string;
        username: string;
      }>(
        `SELECT email, username FROM users
       WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)`,
        [email, username]
      );

      if (existingUsers.length > 0) {
        const emailTaken = existingUsers.some(
          (user) => user.email.toLowerCase() === email.toLowerCase()
        );

        return c.json(
          {
            success: false,
            message: emailTaken
              ? "A user with this email already exists"
              : "That username is already taken",
          },
          409
        );
      }

      // Hash password with bcrypt
      const passwordHash = await bcrypt.hash(password, 10);

      // Insert new user
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
        [email, username, passwordHash]
      );

      return c.json(
        {
          success: true,
          message: "User registered successfully",
          user: {
            id: rows[0].id,
            email: email,
            username: username,
          },
        },
        201
      );
    } catch (error) {
      console.error("Registration error:", error);
      return c.json(
        {
          success: false,
          message: "An error occurred during registration",
        },
        500
      );
    }
  }
);

// POST /auth/login - Authenticate user and return JWT token
authRoutes.post(
  "/login",
  loginRateLimit,
  zValidator("json", loginSchema),
  async (c) => {
    try {
      const { email, password } = c.req.valid("json");

      // Find user by email. LOWER() matches the unique index, so casing in the
      // submitted address never prevents a legitimate login.
      const { rows: users } = await pool.query<{
        id: number;
        email: string;
        username: string;
        password_hash: string;
      }>(
        `SELECT id, email, username, password_hash FROM users
       WHERE LOWER(email) = LOWER($1)`,
        [email]
      );

      if (users.length === 0) {
        // Vague message prevents email enumeration attacks
        return c.json(
          {
            success: false,
            message: "Invalid email or password",
          },
          401
        );
      }

      const user = users[0];

      // Verify password
      const isPasswordValid = await bcrypt.compare(
        password,
        user.password_hash
      );

      if (!isPasswordValid) {
        return c.json(
          {
            success: false,
            message: "Invalid email or password",
          },
          401
        );
      }

      const jwtSecret = config.jwtSecret;

      if (!jwtSecret) {
        console.error("JWT_SECRET is not defined!");
        return c.json(
          {
            success: false,
            message: "Server configuration error",
          },
          500
        );
      }

      // Create JWT token (expires in 7 days)
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
        },
        jwtSecret,
        {
          expiresIn: "7d",
        }
      );

      return c.json({
        success: true,
        message: "Login successful",
        token: token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      return c.json(
        {
          success: false,
          message: "An error occurred during login",
        },
        500
      );
    }
  }
);

export { authRoutes };
