import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static-site playable.
//
// base is "./" because WAKU previews are served from versioned sub-paths, not
// the origin root. Every built asset reference must be relative to index.html.
// `static/` is copied verbatim into `public/` for runtime vendor and locale JSON.
export default defineConfig({
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
