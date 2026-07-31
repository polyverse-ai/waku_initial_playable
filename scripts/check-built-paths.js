// Post-build guard: the platform serves each preview from a versioned GCS
// sub-path (…/<timestamp>-<hash>/index.html), NOT the origin root. Any absolute
// asset URL ("/assets/…", "/vendor/…", "/locales/…") resolves against the origin
// root there and 404s, producing a blank page. The built site MUST reference
// every asset relative to index.html so it is portable to any mount path.
//
// This runs AFTER `vite build` and inspects the real output in public/. If it
// ever finds an absolute internal asset reference, the build fails here instead
// of shipping a white screen.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "public");
assert.ok(existsSync(join(out, "index.html")), "public/index.html must exist (run vite build first)");

const html = readFileSync(join(out, "index.html"), "utf8");

// Absolute src/href into our own asset folders → breaks under sub-path hosting.
const badHtml = [...html.matchAll(/(?:src|href)="(\/(?:assets|vendor|locales)\/[^"]*)"/g)].map((m) => m[1]);
assert.deepEqual(
  badHtml,
  [],
  `built index.html has absolute asset refs (break sub-path hosting): ${badHtml.join(", ")}`
);

// Absolute url() into our own asset folders inside bundled CSS.
const cssDir = join(out, "assets");
const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith(".css")) : [];
for (const f of cssFiles) {
  const css = readFileSync(join(cssDir, f), "utf8");
  const badCss = [...css.matchAll(/url\(\s*["']?(\/(?:assets|vendor|locales)\/[^"')]*)/g)].map((m) => m[1]);
  assert.deepEqual(badCss, [], `built ${f} has absolute url() refs (break sub-path hosting): ${badCss.join(", ")}`);
}

console.log("built paths ok (all relative — portable to sub-path hosting)");
