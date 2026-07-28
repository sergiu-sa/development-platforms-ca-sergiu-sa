import { z } from "zod";

export const wireQuerySchema = z.object({
  section: z.string().trim().min(1).max(80).optional(),
  // Query params arrive as strings, so validate the string shape first and
  // transform after. A regex rather than coercion keeps "1.5" and "nonsense"
  // out rather than silently rounding them.
  page: z
    .string()
    .regex(/^\d+$/, "page must be a positive integer")
    .transform(Number)
    .refine((value) => value >= 1, "page must be at least 1")
    .optional(),
});
