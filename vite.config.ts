import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static-site playable.
//
// base is "./" because WAKU previews are served from versioned sub-paths, not
// the origin root. Every built asset reference must be relative to index.html.
// `static/` is copied verbatim into `public/` for runtime vendor and locale JSON.

// The content runtime is loaded as a classic <script src> on purpose: it is a
// platform-owned file that must reach public/vendor/ byte-for-byte and define
// window.Polyverse before any app code runs; type="module" would hand it to the
// bundler instead. Vite copies it from static/ untouched and keeps the tag
// verbatim, yet still prints
//   <script src="./vendor/polyverse-content-runtime.min.js"> in "/index.html" can't be bundled without type="module" attribute
// which reads as a failed build to anyone seeing it for the first time. Drop
// exactly that line; every other log, warning and error passes through.
const VENDOR_RUNTIME = "vendor/polyverse-content-runtime.min.js";
const UNBUNDLED_CLASSIC_SCRIPT = `can't be bundled without type="module"`;
const logger = createLogger();
const warn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  if (msg.includes(VENDOR_RUNTIME) && msg.includes(UNBUNDLED_CLASSIC_SCRIPT)) return;
  warn(msg, options);
};

export default defineConfig({
  customLogger: logger,
  root: ".",
  base: "./",
  publicDir: "static",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "public",
    emptyOutDir: true,
    target: "es2022",
    // Never inline assets as data: URLs. Share-card images go through
    // app.comment.compose, whose host-side classifier (iOS and simulator
    // alike) only accepts http(s) URLs — an inlined data URL makes the
    // share button degrade to "Sharing unavailable here".
    assetsInlineLimit: 0,
  },
});
