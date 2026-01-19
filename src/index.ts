import { Hono } from "hono";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { testConnection } from "./db/connection.js";


dotenv.config();

const app = new Hono();

app.get("/", (c) => {

  return c.json({
    message: "Welcome to the News API!",
    status: "Server is running",
    version: "1.0.0",
    endpoints: {
      // TODO: These endpoints will be implemented in Phase 2
      health: "GET /",
      register: "POST /auth/register (coming in Phase 2)",
      login: "POST /auth/login (coming in Phase 2)",
      getArticles: "GET /articles (coming in Phase 2)",
      createArticle: "POST /articles (coming in Phase 2)",
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
console.log(`   GET  http://localhost:${PORT}/        - Welcome message`);
console.log(`   GET  http://localhost:${PORT}/health  - Database health check`);
console.log("\nPress Ctrl+C to stop the server.");
