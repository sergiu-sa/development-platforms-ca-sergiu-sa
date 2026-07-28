/**
 * Authentication Validation Schemas
 */

import { z } from "zod";

// Public display name shown on articles. Deliberately narrow: it appears in
// URLs and rendered HTML, so keep it to characters that need no escaping.
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const registerSchema = z.object({
  email: z
    .string({
      required_error: "Email is required",
    })
    .email("Please provide a valid email address"),

  username: z
    .string({
      required_error: "Username is required",
    })
    .min(3, "Username must be at least 3 characters long")
    .max(30, "Username must be less than 30 characters")
    .regex(
      USERNAME_PATTERN,
      "Username can only contain letters, numbers, hyphens and underscores"
    ),

  password: z
    .string({
      required_error: "Password is required",
    })
    .min(6, "Password must be at least 6 characters long"),
});

export const loginSchema = z.object({
  email: z
    .string({
      required_error: "Email is required",
    })
    .email("Please provide a valid email address"),

  password: z
    .string({
      required_error: "Password is required",
    })
    .min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
