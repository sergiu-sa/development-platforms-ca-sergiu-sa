import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * `/b/:slug` is a real path in production, where vercel.json rewrites it to the API route that generates the document.
 * Vite knows nothing about that rewrite, so in development the pretty path would 404 and the page could only be reached as /b.html.
 *
 * This maps it to the entry so the URL is the same in both places.
 * It is development only, and it means the *server-rendered* document;
 * the meta tags and the inlined data - is never exercised locally.
 * That seam is why the phase is not finished until /b/:slug has been curled on a real preview deployment.
 */
const briefingDevRoute = (): Plugin => ({
  name: "briefing-dev-route",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/b\/[^/?#]+/.test(req.url)) {
        req.url = "/b.html";
      }
      next();
    });
  },
});

export default defineConfig({
  root: "web",
  plugins: [tailwindcss(), briefingDevRoute()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: entry("web/index.html"),
        desk: entry("web/desk.html"),
        login: entry("web/login.html"),
        register: entry("web/register.html"),
        briefing: entry("web/b.html"),
        briefings: entry("web/briefings.html"),
      },
      output: {
        // Two files carry no content hash, because the server composes the briefing document and has to be able to name them:
        // that page's entry chunk, and the stylesheet every page shares.
        //
        // The hash is not doing any work to lose.
        // Measured against the livesite rather than assumed:
        // a hashed asset there answers `cache-control: public, max-age=0, must-revalidate`, which is exactly what an unhashed file answers.
        // With `framework:
        // null` and a custom output directory, Vercel applies no immutable caching to hashed names, so nothing is cached on the strength of the hash and nothing is lost by dropping it.
        // Revalidation still picks up a redeploy.
        //
        // Fonts keep their hashes: they are never named by the server, and renaming them churns the largest files in the build for nothing.
        entryFileNames: (chunk) =>
          chunk.name === "briefing"
            ? "assets/briefing.js"
            : "assets/[name]-[hash].js",
        // The stylesheet is named outright rather than with [name].
        // Every page shares one CSS bundle, and Vite names that chunk after whichever entry it happened to hang it off;
        // it came out as `app.css` and then as `api.css` when an unrelated entry changed.
        // The server has to write this filename into the document it generates, so it cannot be something that moves.
        // A second CSS bundle would collide with this name, which Task 9 checks for by counting the files in the build.
        assetFileNames: (asset) =>
          (asset.names?.[0] ?? "").endsWith(".css")
            ? "assets/lede.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    // The API stays same-origin in the browser, exactly as in production, so no CORS is ever needed and API_BASE remains "/api".
    proxy: { "/api": { target: "http://localhost:3000" } },
  },
});
