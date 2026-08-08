import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "web",
  plugins: [tailwindcss()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: entry("web/index.html"),
        desk: entry("web/desk.html"),
        login: entry("web/login.html"),
        register: entry("web/register.html"),
      },
    },
  },
  server: {
    port: 5173,
    // The API stays same-origin in the browser, exactly as in production, so
    // no CORS is ever needed and API_BASE remains "/api".
    proxy: { "/api": { target: "http://localhost:3000" } },
  },
});
