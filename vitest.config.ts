import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "web/src/**/*.test.ts"],

    // NODE_ENV=test makes src/config/env.ts load .env.test instead of .env.
    // Set explicitly rather than relying on Vitest's default.
    env: {
      NODE_ENV: "test",
    },

    // Every test file shares one database and truncates it between tests, so
    // they must not run concurrently. Files are still isolated from each other,
    // which is what gives each file its own connection pool.
    fileParallelism: false,
  },
});
