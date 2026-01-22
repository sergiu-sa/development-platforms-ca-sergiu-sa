/**
 * Articles Routes
 * GET  /articles - Public: Get all articles
 * POST /articles - Protected: Create new article (requires JWT)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { pool } from "../../db/connection.js";
import { createArticleSchema } from "./articles.schema.js";
import { authMiddleware } from "../../middleware/auth.js";
import { RowDataPacket, ResultSetHeader } from "mysql2";

const articleRoutes = new Hono();

// GET /articles - Public endpoint, returns all articles with author info
articleRoutes.get("/", async (c) => {
  try {
    const [articles] = await pool.query<RowDataPacket[]>(`
      SELECT
        articles.id,
        articles.title,
        articles.body,
        articles.category,
        articles.submitted_by,
        articles.created_at,
        users.email as author_email
      FROM articles
      LEFT JOIN users ON articles.submitted_by = users.id
      ORDER BY articles.created_at DESC
    `);

    return c.json({
      success: true,
      count: articles.length,
      articles: articles,
    });
  } catch (error) {
    console.error("Error fetching articles:", error);
    return c.json(
      {
        success: false,
        message: "Failed to fetch articles",
      },
      500
    );
  }
});

// POST /articles - Protected endpoint, creates new article
// submitted_by comes from JWT token to prevent impersonation
articleRoutes.post(
  "/",
  authMiddleware,
  zValidator("json", createArticleSchema),
  async (c) => {
    try {
      const { title, body, category } = c.req.valid("json");
      const user = c.get("user");

      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO articles (title, body, category, submitted_by)
         VALUES (?, ?, ?, ?)`,
        [title, body, category, user.userId]
      );

      const [createdArticles] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM articles WHERE id = ?",
        [result.insertId]
      );

      return c.json(
        {
          success: true,
          message: "Article created successfully",
          article: createdArticles[0],
        },
        201
      );
    } catch (error) {
      console.error("Error creating article:", error);
      return c.json(
        {
          success: false,
          message: "Failed to create article",
        },
        500
      );
    }
  }
);

export { articleRoutes };
