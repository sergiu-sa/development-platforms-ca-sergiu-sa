/**
 * Authentication Validation Schemas
 */

import { z } from "zod";

// Public display name shown on articles. Deliberately narrow:
// it appears in URLs and rendered HTML, so keep it to characters that need no escaping.
//
// The bounds are exported beside it because phase 11 gave a username its own address at /u/:username, and the param check there has to refuse exactly what registration refuses.
// Two hand-written copies of one rule would agree until the day somebody widened only one of them, and the half that matters is the one deciding what reaches Postgres.
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

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
    .min(
      USERNAME_MIN,
      `Username must be at least ${USERNAME_MIN} characters long`
    )
    .max(USERNAME_MAX, `Username must be less than ${USERNAME_MAX} characters`)
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
