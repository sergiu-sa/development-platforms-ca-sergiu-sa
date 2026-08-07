import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "web/src/**/*.test.ts"],

    // NODE_ENV=test makes src/config/env.ts load .env.test instead of .env.
    // Set explicitly rather than relying on Vitest's default.
    //
    // TZ is pinned because the desk's dates are deliberately local: `dayKey`,`dayBounds` and the two Intl formatters in `desk/desk-view.ts` all mean
    // something different per zone, and CI runs in UTC. Under UTC the daylight-saving case in `desk/edition.test.ts` passes against a naive `+ 86_400_000` implementation, so the guard only bit on a developer's own machine.
    // A zone that observes DST is what makes it a guard.
    env: {
      NODE_ENV: "test",
      TZ: "Europe/Oslo",
    },

    // Every test file shares one database and truncates it between tests, so they must not run concurrently.
    // Files are still isolated from each other, which is what gives each file its own connection pool.
    fileParallelism: false,
  },
});
