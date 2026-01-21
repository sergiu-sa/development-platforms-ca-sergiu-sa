import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/connection.js";
import { registerSchema, loginSchema } from "../schemas/auth.schema.js";
import { RowDataPacket, ResultSetHeader } from "mysql2";

const authRoutes = new Hono();

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  try {
    const { email, password } = c.req.valid("json");

    const [existingUsers] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingUsers.length > 0) {
      return c.json(
        {
          success: false,
          message: "A user with this email already exists",
        },
        409
      );
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)",
      [email, passwordHash]
    );

    return c.json(
      {
        success: true,
        message: "User registered successfully",
        user: {
          id: result.insertId,
          email: email,
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

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  try {
    const { email, password } = c.req.valid("json");

    const [users] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, password_hash FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return c.json(
        {
          success: false,
          message: "Invalid email or password",
        },
        401
      );
    }

    const user = users[0];

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

    const jwtSecret = process.env.JWT_SECRET;

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

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
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
