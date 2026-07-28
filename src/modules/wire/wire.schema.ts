import { z } from "zod";

/**
 * Upper bound on `page`.
 *
 * Validating only the shape ("all digits") is not enough: a large enough value
 * pushes the computed OFFSET into scientific notation ("2e+21"), which Postgres
 * rejects as a bigint and which surfaced as a 500 reachable from the URL bar.
 * At 20 per page this still allows 200,000 stories, far past anything the wire
 * will hold.
 */
export const MAX_WIRE_PAGE = 10_000;

export const wireQuerySchema = z.object({
  section: z.string().trim().min(1).max(80).optional(),
  // Query params arrive as strings, so validate the string shape first and
  // transform after. A regex rather than coercion keeps "1.5" and "nonsense"
  // out rather than silently rounding them.
  page: z
    .string()
    .regex(/^\d+$/, "page must be a positive integer")
    .transform(Number)
    .refine(
      (value) => value >= 1 && value <= MAX_WIRE_PAGE,
      `page must be between 1 and ${MAX_WIRE_PAGE}`
    )
    .optional(),
});
