/**
 * Article Validation Schema
 */

import { z } from "zod";

export const ARTICLE_CATEGORIES = [
  "Tech",
  "Sports",
  "Politics",
  "Entertainment",
  "Business",
  "Other",
] as const;

export const createArticleSchema = z.object({
  title: z
    .string({
      required_error: "Title is required",
    })
    .min(3, "Title must be at least 3 characters long")
    .max(200, "Title must be less than 200 characters"),

  body: z
    .string({
      required_error: "Article body is required",
    })
    .min(10, "Article body must be at least 10 characters long"),

  category: z.enum(ARTICLE_CATEGORIES, {
    errorMap: () => ({
      message: `Category must be one of: ${ARTICLE_CATEGORIES.join(", ")}`,
    }),
  }),
});

export type CreateArticleInput = z.infer<typeof createArticleSchema>;

export interface Article {
  id: number;
  title: string;
  body: string;
  category: string;
  submitted_by: number;
  created_at: Date;
}

export interface ArticleWithAuthor extends Article {
  author_email: string;
}
