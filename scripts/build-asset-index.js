// Post-build asset index: collect every remote asset URL the built site will
// request and inject the list as the FIRST element of public/index.html <head>,
// as <script type="application/polyverse-asset-index">.
//
// Why: the iOS host prewarms a playable by fetching index.html before any JS
// executes. Remote asset URLs (MCP-generated media on GCS) otherwise live only
// inside the minified JS bundle, invisible without running the page. This block
// gives the native layer a machine-readable index — parse the first few KB of
// index.html, warm every URL, and the WebView starts with a hot HTTP cache.
//
// This runs AFTER `vite build` (and before check-built-paths.js in npm test).
// It also guards against silent gaps: every asset URL literal found in src/ or
// static/ must reappear in the built output, so a URL that only exists half-
// assembled (e.g. runtime string concatenation) fails the build here instead of
// shipping an index that quietly misses assets.
//
// Shape (schema_version 2) is the host's own resource-manifest shape, so the
// same bytes work through either carrier — this inline <head> tag, or a
// same-origin JSON served at `ContentItem.resource_manifest_url`:
//
//   { "schema_version": 2, "entrypoint": "index.html",
//     "resources": [ { "url": "https://…/bgm.mp3", "kind": "audio" },
//                    { "path": "assets/bg.webp",   "kind": "image" } ] }
//
// - `url` = absolute remote asset; `path` = bundled asset, relative to the
//   entry html (the host resolves it against the launch URL's directory).
// - `kind` vocabulary: video / audio / image. Entries the classifier can't
//   type (asset-host URLs with no media extension) ship without `kind` and the
//   host derives it from the extension.
// - `bytes` / `sha256` are optional in the host schema; we don't emit them.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "public");
assert.ok(existsSync(join(out, "index.html")), "public/index.html must exist (run vite build first)");

const EXT = {
  videos: [".mp4", ".webm", ".mov"],
  audio: [".mp3", ".wav", ".ogg", ".m4a", ".aac"],
  images: [".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".avif"],
};
const MEDIA_EXTS = new Set(Object.values(EXT).flat());
// Platform asset storage. URLs on this host are indexed even without a media
// extension; other hosts are indexed only when the path has a media extension,
// which keeps license/docs links embedded in vendored bundles out of the index.
const ASSET_HOSTS = new Set(["storage.googleapis.com"]);
const TEXT_EXTS = new Set([".js", ".css", ".html", ".json", ".ts", ".tsx"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

// Pull candidate asset URLs out of one text blob. Trailing junk (quotes,
// parens, punctuation) is excluded by the character class; escaped slashes in
// JSON-in-JS strings are not, so trim any trailing backslash remnants.
function extractUrls(text) {
  const found = new Set();
  for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9._~:/%#@!$&+,;=-]+/g)) {
    const url = m[0].replace(/[.,;:!]+$/, "");
    let host, pathname;
    try {
      ({ host, pathname } = new URL(url));
    } catch {
      continue;
    }
    const ext = extname(pathname).toLowerCase();
    if (ASSET_HOSTS.has(host) || MEDIA_EXTS.has(ext)) found.add(url);
  }
  return found;
}

// Group name (local taxonomy) -> host `kind` vocabulary.
const KIND_BY_GROUP = { videos: "video", audio: "audio", images: "image" };
const KIND_ORDER = ["video", "audio", "image"];

function kindFor(pathname) {
  const ext = extname(pathname).toLowerCase();
  const group = Object.keys(EXT).find((k) => EXT[k].includes(ext));
  return group ? KIND_BY_GROUP[group] : undefined;
}

// Untyped entries last, so a host that walks the list in order hits the
// classifiable media first.
const rank = (e) => (e.kind ? KIND_ORDER.indexOf(e.kind) : KIND_ORDER.length);
const byKind = (a, b) => rank(a) - rank(b) || (a.url ?? a.path).localeCompare(b.url ?? b.path);

function remoteResources(urls) {
  return [...urls]
    .map((url) => {
      const kind = kindFor(new URL(url).pathname);
      return kind ? { url, kind } : { url };
    })
    .sort(byKind);
}

function scanTree(dir) {
  const urls = new Set();
  if (!existsSync(dir)) return urls;
  for (const f of walk(dir)) {
    if (!TEXT_EXTS.has(extname(f))) continue;
    for (const u of extractUrls(readFileSync(f, "utf8"))) urls.add(u);
  }
  return urls;
}

const builtUrls = scanTree(out);

// Guard: an asset URL authored in source must survive into the build verbatim.
// A miss means the URL never reaches the shipped bundle as one literal — the
// index (and the prewarm) would silently skip it. Keep asset URLs as complete
// string literals (the src/lib/assets.ts convention) and this never fires.
const sourceUrls = new Set([...scanTree(join(root, "src")), ...scanTree(join(root, "static"))]);
const missing = [...sourceUrls].filter((u) => !builtUrls.has(u));
assert.deepEqual(
  missing,
  [],
  `asset URLs found in src/ or static/ but not in the built output (are they split or concatenated at runtime?): ${missing.join(", ")}`
);

// Local (same-origin) media shipped inside the site bundle, relative to
// index.html — playables that download their assets into static/ instead of
// hot-linking GCS still get a warmable list.
const local = [...walk(out)]
  .filter((f) => MEDIA_EXTS.has(extname(f).toLowerCase()))
  .map((f) => ({ path: relative(out, f), kind: kindFor(f) }))
  .sort(byKind);

const index = {
  schema_version: 2,
  entrypoint: "index.html",
  resources: [...remoteResources(builtUrls), ...local],
};

const htmlPath = join(out, "index.html");
const html = readFileSync(htmlPath, "utf8");
const tag = `<script type="application/polyverse-asset-index">${JSON.stringify(index)}</script>`;
const stripped = html.replace(/\s*<script type="application\/polyverse-asset-index">.*?<\/script>/s, "");
assert.ok(stripped.includes("<head>"), "built index.html must have a <head> to inject the asset index into");
writeFileSync(htmlPath, stripped.replace("<head>", `<head>\n    ${tag}`));

const counts = [...KIND_ORDER, undefined]
  .map((kind) => `${kind ?? "untyped"} ${index.resources.filter((r) => r.kind === kind).length}`)
  .join(", ");
const remoteCount = index.resources.filter((r) => r.url).length;
console.log(
  `asset index v${index.schema_version} injected into public/index.html ` +
    `(${index.resources.length} resources: ${counts}; ${remoteCount} remote, ${index.resources.length - remoteCount} bundled)`
);
