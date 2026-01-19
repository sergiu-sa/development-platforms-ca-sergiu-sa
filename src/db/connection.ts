import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,

  user: process.env.DB_USER || "root",

  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "news_api",
  connectionLimit: 10,

  waitForConnections: true,

  queueLimit: 0,
});

export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();

    console.log("✅ Database connection successful!");

    connection.release();

    return true;
  } catch (error) {
    console.error("❌ Database connection failed!");
    console.error("Error details:", error);
    console.error("\n📋 Troubleshooting checklist:");
    console.error("   1. Is MySQL running on your computer?");
    console.error("   2. Did you create a .env file from .env.example?");
    console.error("   3. Are your database credentials correct in .env?");
    console.error('   4. Did you create the "news_api" database?');
    console.error(
      "   5. Did you run the database.sql file in MySQL Workbench?"
    );

    return false;
  }
}

export { pool };
