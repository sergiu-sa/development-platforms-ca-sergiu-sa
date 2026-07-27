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
import { RowDataPacket, ResultSetHeader } from "mysql2";

const authRoutes = new Hono();

// POST /auth/register - Create new user account
authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  try {
    const { email, username, password } = c.req.valid("json");

    // Check whether either identifier is taken. Usernames are compared
    // case-insensitively so "Alice" cannot shadow "alice" on article bylines.
    const [existingUsers] = await pool.query<RowDataPacket[]>(
      "SELECT email, username FROM users WHERE email = ? OR LOWER(username) = LOWER(?)",
      [email, username]
    );

    if (existingUsers.length > 0) {
      const emailTaken = existingUsers.some((user) => user.email === email);

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
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
      [email, username, passwordHash]
    );

    return c.json(
      {
        success: true,
        message: "User registered successfully",
        user: {
          id: result.insertId,
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
});

// POST /auth/login - Authenticate user and return JWT token
authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  try {
    const { email, password } = c.req.valid("json");

    // Find user by email
    const [users] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, username, password_hash FROM users WHERE email = ?",
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
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

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
});

export { authRoutes };
