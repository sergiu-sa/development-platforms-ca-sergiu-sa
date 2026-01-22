/**
 * News API - Main Server Entry Point
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { validateEnv, config } from "./config/env.js";
import { pool, testConnection } from "./db/connection.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { articleRoutes } from "./modules/articles/articles.route.js";

validateEnv();

const app = new Hono();

// CORS - allows frontend apps from different domains to call this API
app.use("/*", cors());

// Welcome route
app.get("/", (c) => {
  return c.json({
    message: "Welcome to the News API!",
    status: "Server is running",
    version: "1.0.0",
    endpoints: {
      health: "GET /",
      register: "POST /auth/register",
      login: "POST /auth/login",
      getArticles: "GET /articles (public)",
      createArticle: "POST /articles (requires auth)",
    },
  });
});

// Health check endpoint for monitoring
app.get("/health", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return c.json(
      {
        status: "unhealthy",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      503
    );
  }
});

// Mount route modules
app.route("/auth", authRoutes);
app.route("/articles", articleRoutes);

// Start server
const PORT = config.port;

console.log("🚀 Starting News API server...");
console.log(`📍 Server will run on: http://localhost:${PORT}`);

testConnection().then((connected) => {
  if (!connected) {
    console.log("\n⚠️  Server starting without database connection.");
    console.log("   Fix database issues and restart the server.");
  }
});

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`✅ Server is running on http://localhost:${PORT}`);
console.log("\n📝 Available endpoints:");
console.log(`   GET  http://localhost:${PORT}/              - Welcome message`);
console.log(
  `   GET  http://localhost:${PORT}/health        - Database health check`
);
console.log(
  `   POST http://localhost:${PORT}/auth/register - Register new user`
);
console.log(`   POST http://localhost:${PORT}/auth/login    - Login user`);
console.log(
  `   GET  http://localhost:${PORT}/articles      - Get all articles (public)`
);
console.log(
  `   POST http://localhost:${PORT}/articles      - Create article (auth required)`
);
console.log("\nPress Ctrl+C to stop the server.");
