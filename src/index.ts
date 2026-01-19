import { Hono } from "hono";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { testConnection } from "./db/connection.js";
import { authRoutes } from "./routes/auth.js";

dotenv.config();

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    message: "Welcome to the News API!",
    status: "Server is running",
    version: "1.0.0",
    endpoints: {
      health: "GET /",
      register: "POST /auth/register",
      login: "POST /auth/login",
      getArticles: "GET /articles (coming in Phase 3)",
      createArticle: "POST /articles (coming in Phase 3)",
    },
  });
});

app.get("/health", async (c) => {
  const dbConnected = await testConnection();

  if (dbConnected) {
    return c.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } else {
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

app.route("/auth", authRoutes);

const PORT = Number(process.env.PORT) || 3000;

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
console.log("\nPress Ctrl+C to stop the server.");
