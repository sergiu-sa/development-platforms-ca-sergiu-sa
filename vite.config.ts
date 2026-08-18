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

/**
 * The distinct stylesheets this build has named.
 *
 * `assetFileNames` below names **any** stylesheet `assets/lede.css`, because the server writes that filename into the document it generates for /b/:slug and so cannot be told a hash.
 * One bundle exists today, so nothing collides.
 * The moment Rollup splits the CSS - a second entry importing something the others do not, most likely - two chunks claim one filename and one of them silently wins.
 * The loser is unstyled, and the page that loses is whichever one the document names.
 *
 * **Distinct names, not calls.** Measured while writing this: the naming hook runs *twice for the same asset* on the current build, both times as `auth.css`, and one file lands in `dist/web`.
 * A guard counting invocations therefore fails on a perfectly good build, and a guard that cries wolf on every build is one somebody deletes.
 * The real signal is the source name, because Vite names the chunk after whichever entry it hung it off - which is exactly how this filename moved from `app.css` to `api.css` in phase 9.
 *
 * It belongs at the point of naming rather than in a test: the suite never runs a build, so a check living there would be describing an output it has not seen.
 */
const stylesheets = new Set<string>();

/** Clears the set, so `vite build --watch` does not accumulate names across rebuilds. */
const countStylesheets = (): Plugin => ({
  name: "count-stylesheets",
  apply: "build",
  buildStart() {
    stylesheets.clear();
  },
});

export default defineConfig({
  root: "web",
  plugins: [tailwindcss(), briefingDevRoute(), countStylesheets()],
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
        build: entry("web/build.html"),
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
        // A second CSS bundle would collide with this name, which is what the count above exists to refuse.
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? "";

          if (!name.endsWith(".css")) {
            return "assets/[name]-[hash][extname]";
          }

          stylesheets.add(name);

          if (stylesheets.size > 1) {
            throw new Error(
              `This build split its CSS into ${stylesheets.size} chunks (${[...stylesheets].join(", ")}), ` +
                'and every one of them would be named "assets/lede.css".\n' +
                "One would overwrite the other, and the page whose generated document names that file would ship unstyled.\n" +
                "Either keep the CSS in one chunk, or give the briefing document a way to learn the real filename."
            );
          }

          return "assets/lede.css";
        },
      },
    },
  },
  server: {
    port: 5173,
    // The API stays same-origin in the browser, exactly as in production, so no CORS is ever needed and API_BASE remains "/api".
    proxy: { "/api": { target: "http://localhost:3000" } },
  },
});
