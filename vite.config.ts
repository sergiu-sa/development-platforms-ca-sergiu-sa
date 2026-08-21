import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The pretty paths, and the entry each one falls back to in development.
 *
 * Both are real paths in production, where vercel.json rewrites them to the API routes that generate their documents.
 * Vite knows nothing about those rewrites, so without this they would 404 here and the pages could only be reached as /b.html and /u.html.
 *
 * **This is one of three places the same mapping is written**, and the other two are `vercel.json` and the client regex that reads the parameter back out.
 * Three hooks are correct because the runtimes genuinely differ; three hand-written copies of the data are not, and `tests/pretty-paths.test.ts` is what stops them drifting.
 *
 * It is development only, which means the *server-rendered* document - the meta tags and the inlined data - is never exercised locally.
 * That seam is why neither page is finished until it has been curled on a real preview deployment.
 */
export const PRETTY_PATHS = [
  { prefix: "b", entry: "/b.html" },
  { prefix: "u", entry: "/u.html" },
];

/** Compiled once. The middleware runs on every dev request, assets and HMR included. */
const PRETTY_PATTERNS = PRETTY_PATHS.map(({ prefix, entry }) => ({
  pattern: new RegExp(`^/${prefix}/[^/?#]+`),
  entry,
}));

const prettyDevRoutes = (): Plugin => ({
  name: "pretty-dev-routes",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      for (const { pattern, entry } of PRETTY_PATTERNS) {
        if (req.url && pattern.test(req.url)) {
          req.url = entry;
          break;
        }
      }
      next();
    });
  },
});

/**
 * The filenames the server writes into the documents it generates, and so the filenames this build is not allowed to move.
 *
 * `/b/:slug` and `/u/:username` are composed on the server, which cannot be told a content hash, so their entry chunks and the shared stylesheet are named outright below.
 * The hash is not doing any work to lose: measured against the live site, a hashed asset there answers `cache-control: public, max-age=0, must-revalidate`, which is exactly what an unhashed one answers, because `framework: null` and a custom output directory mean Vercel applies no immutable caching to hashed names.
 * Fonts keep their hashes; they are never named by a server and renaming them churns the largest files in the build for nothing.
 */
export const PINNED = {
  briefing: "assets/briefing.js",
  profile: "assets/profile.js",
} as const;

export const STYLESHEET = "assets/lede.css";

/**
 * Every CSS source name Rollup has asked this build to name.
 *
 * `assetFileNames` returns one constant for any stylesheet, so by the time a chunk reaches the finished bundle a collision has already resolved - two chunks claiming `assets/lede.css` become one key, and the loser is simply gone.
 * The naming hook is therefore the only place the pre-collision information exists, which is why this half of the guard has to live here rather than in `generateBundle`.
 *
 * **Distinct names, not calls.** Measured in phase 10: the hook runs *twice for the same asset* on the current build, both times as `auth.css`, and one file lands in `dist/web`.
 * A guard counting invocations fails a perfectly good build, and a guard that cries wolf is one somebody deletes.
 *
 * The blind spot it keeps: two genuine CSS chunks that happen to share a source name would still pass. Nothing has produced that, and the check below catches the consequence if it ever does.
 */
const cssSourceNames = new Set<string>();

/**
 * The two halves of "the names the server writes into a document are real".
 *
 * `buildStart` clears the set so `vite build --watch` does not accumulate across rebuilds.
 * `generateBundle` sees what will actually be written, and asks the one question the naming hook cannot: is each pinned filename genuinely there.
 * A missing one means a generated document points at a 404 and that page never mounts - which is exactly the failure mode of a renamed entry, and the reason this covers the two scripts rather than only the stylesheet.
 *
 * It lives here rather than in a test because the suite never runs a build, so a check there would be describing an output it has not seen.
 */
const pinnedAssets = (): Plugin => ({
  name: "pinned-assets",
  apply: "build",
  buildStart() {
    cssSourceNames.clear();
  },
  generateBundle(_options, bundle) {
    const missing = [...Object.values(PINNED), STYLESHEET].filter(
      (name) => !(name in bundle)
    );

    if (missing.length > 0) {
      const emitted = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/"))
        .join(", ");

      throw new Error(
        `This build emitted no ${missing.map((name) => `"${name}"`).join(" and no ")}.\n` +
          "A server-composed document names that file outright, so the page it belongs to would load a 404 and never mount.\n" +
          `Emitted: ${emitted}`
      );
    }
  },
});

export default defineConfig({
  root: "web",
  plugins: [tailwindcss(), prettyDevRoutes(), pinnedAssets()],
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
        profile: entry("web/u.html"),
      },
      output: {
        // The two server-composed pages get their names from PINNED; everything else keeps its hash.
        // `Object.hasOwn` rather than `in`: `in` walks the prototype chain, so an entry named `constructor` or `toString` would match and hand Rollup a Function where it wants a filename.
        entryFileNames: (chunk) =>
          Object.hasOwn(PINNED, chunk.name)
            ? PINNED[chunk.name as keyof typeof PINNED]
            : "assets/[name]-[hash].js",
        // The stylesheet is named outright rather than with [name].
        // Every page shares one CSS bundle, and Vite names that chunk after whichever entry it happened to hang it off;
        // it came out as `app.css` and then as `api.css` when an unrelated entry changed.
        // The server has to write this filename into the documents it generates, so it cannot be something that moves.
        // `pinnedAssets` above is what refuses a build where two chunks would claim it.
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? "";

          if (!name.endsWith(".css")) {
            return "assets/[name]-[hash][extname]";
          }

          cssSourceNames.add(name);

          if (cssSourceNames.size > 1) {
            throw new Error(
              `This build split its CSS into ${cssSourceNames.size} chunks (${[...cssSourceNames].join(", ")}), ` +
                `and every one of them would be named "${STYLESHEET}".\n` +
                "One would overwrite the other, and the page whose generated document names that file would ship unstyled.\n" +
                "Either keep the CSS in one chunk, or give the generated documents a way to learn the real filename."
            );
          }

          return STYLESHEET;
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
