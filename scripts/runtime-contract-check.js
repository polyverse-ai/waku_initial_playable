import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const html = read("index.html");
const manifest = readManifest(html);
const capabilityReference = readCapabilityReference(html);

const runtimeScriptIndex = html.indexOf("vendor/polyverse-content-runtime.min.js");
const appScriptIndex = html.indexOf("src/main.tsx");

assert.ok(runtimeScriptIndex >= 0, "index.html must load the Polyverse runtime bundle");
assert.ok(appScriptIndex >= 0, "index.html must load the React app entry (src/main.tsx)");
assert.ok(runtimeScriptIndex < appScriptIndex, "runtime bundle must load before app code");
assert.match(html, /<div\s+id=["']root["']><\/div>/, "index.html must expose React root #root");

assert.equal(typeof manifest.runtime, "string", "manifest.runtime must be a top-level string");
assert.ok(Array.isArray(manifest.capabilities), "manifest.capabilities must be an array");
assert.equal(
  Object.prototype.hasOwnProperty.call(manifest, "requestedCapabilities"),
  false,
  "new source must use capabilities, not requestedCapabilities",
);
// Validate every declared capability against the known platform vocabulary instead
// of pinning an exact list. Pinning forced an edit to this file on every single run
// (each content declares a different real capability set) — pure rework with no value.
// Correctness still enforced: unknown/typo'd/invented capabilities fail; the
// jobs.read implication is checked below. Whether a declared capability is actually
// called is the author's responsibility, verified by the browser smoke, not here.
const knownCapabilities = new Set(capabilityReference.capabilities.map((c) => c.id));
for (const cap of manifest.capabilities) {
  assert.ok(
    knownCapabilities.has(cap),
    `manifest declares unknown capability "${cap}" — not in the platform capability vocabulary`,
  );
}

const jobBackedCapabilities = new Set([
  "multimodal.generate.image",
  "multimodal.generate.video",
  "multimodal.generate.audio",
  "multimodal.transcribe.audio",
  "llm.chat.vision",
]);
const needsJobRead = manifest.capabilities.some((capability) => jobBackedCapabilities.has(capability));
if (needsJobRead) {
  assert.ok(
    manifest.capabilities.includes("multimodal.jobs.read"),
    "AI jobs that wait or poll must declare multimodal.jobs.read",
  );
}

assert.equal(capabilityReference.referenceOnly, true, "capability reference must be marked referenceOnly");
assert.ok(Array.isArray(capabilityReference.capabilities), "capability reference must list capabilities");

// The reference must cover every content-callable capability the vendored SDK knows.
// Anchor on the bundle's METHOD_CAPABILITIES map, so replacing the bundle with one
// that adds a capability fails here until the reference documents it — that is what
// keeps this teaching surface from drifting behind the SDK.
const referenceIds = new Set(capabilityReference.capabilities.map((c) => c.id));
const bundleSource = read("static/vendor/polyverse-content-runtime.min.js");
const methodCapabilitiesMatch = bundleSource.match(/const METHOD_CAPABILITIES = \{([\s\S]*?)\}/);
assert.ok(methodCapabilitiesMatch, "vendored runtime bundle must contain METHOD_CAPABILITIES");
const bundleCapabilities = new Set(
  [...methodCapabilitiesMatch[1].matchAll(/"[A-Za-z0-9_.-]+":\s*"([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]),
);
assert.ok(bundleCapabilities.size >= 30, "METHOD_CAPABILITIES parse looks wrong (too few entries)");
// Dynamic-dispatch families (multimodal.generate + params.capability) never appear as
// METHOD_CAPABILITIES values; they are part of the platform vocabulary all the same.
for (const dynamicCapability of [
  "llm.chat",
  "llm.chat.vision",
  "multimodal.generate.image",
  "multimodal.generate.video",
  "multimodal.generate.audio",
  "multimodal.transcribe.audio",
]) {
  bundleCapabilities.add(dynamicCapability);
}
for (const expected of bundleCapabilities) {
  assert.ok(
    referenceIds.has(expected),
    `capability reference must include ${expected} (SDK bundle knows it; teach it or the vocabulary drifts)`,
  );
}

const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.dependencies?.react, "template must depend on React");
assert.ok(pkg.dependencies?.["react-dom"], "template must depend on react-dom");
assert.ok(pkg.devDependencies?.tailwindcss, "template must depend on Tailwind CSS");
assert.ok(pkg.devDependencies?.["@vitejs/plugin-react"], "template must use the React Vite plugin");
assert.ok(pkg.devDependencies?.["@tailwindcss/vite"], "template must use the Tailwind Vite plugin");

const bundlePath = join(root, "static", "vendor", "polyverse-content-runtime.min.js");
assert.ok(existsSync(bundlePath), "vendor runtime bundle must exist under static/vendor");
assert.ok(statSync(bundlePath).size > 20_000, "vendor runtime bundle looks too small");
assert.match(readFileSync(bundlePath, "utf8"), /Polyverse/);

for (const sourceFile of [
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "src/content/Content.tsx",
  "src/waku/polyverse.ts",
  "src/waku/safe-area.tsx",
  "src/waku/audio-lifecycle.ts",
]) {
  const source = read(sourceFile);
  assert.doesNotMatch(
    source,
    /Authorization:\s*Bearer/i,
    `${sourceFile} must not hand-roll authenticated requests — call the platform through the SDK (window.Polyverse)`,
  );
  // Case-sensitive on purpose: only SCREAMING_SNAKE credential constants are a leak.
  // Lowercase/camelCase identifiers such as `shareToken` are legitimate SDK vocabulary.
  assert.doesNotMatch(
    source,
    /[A-Z0-9_]*(API_KEY|SECRET|TOKEN)\b/,
    `${sourceFile} must not ship credentials — a playable never carries its own provider keys`,
  );
}

const app = read("src/App.tsx");
assert.doesNotMatch(app, /\.\/components\//, "src/App.tsx must not import template-owned shell from src/components/");

// Floor shell primitives now live in src/waku/safe-area.tsx (BgLayer/Stage/SafeUI),
// so content composes them instead of hand-writing the platform class names. The
// class-name + data-lifecycle contract is therefore asserted on that component.
const safeArea = read("src/waku/safe-area.tsx");
assert.match(safeArea, /className=["']bg-layer["']/, "src/waku/safe-area.tsx must hard-code .bg-layer (BgLayer)");
assert.match(safeArea, /className=["']safe-ui["']/, "src/waku/safe-area.tsx must hard-code .safe-ui (SafeUI)");
assert.match(safeArea, /data-lifecycle=/, "src/waku/safe-area.tsx must expose data-lifecycle for the machine smoke to assert freeze/resume");

const css = read("src/index.css");
for (const requiredSelector of [".bg-layer", ".stage", ".safe-ui", ".safe-center", ".core-target"]) {
  assert.ok(css.includes(requiredSelector), `src/index.css must keep ${requiredSelector}`);
}

// Import-guard: the toolkit skeleton lives pre-installed in recipes/toolkit/. A copy
// of any of those modules inside src/ means it was re-derived or duplicated instead
// of imported, and the two copies then drift apart. Import from
// recipes/toolkit/<slug>; don't copy it into src/.
const vendoredSlugs = [
  "juice-fx-layer", "seeded-verdict-bank", "responsive-canvas-stage",
  "result-card-canvas-toolkit", "media-element-audio", "fixed-step-game-loop",
  "seeded-random-utils", "score-combo-tracker", "archetype-typing-kit",
];
for (const slug of vendoredSlugs) {
  for (const wrong of [`src/lib/${slug}.ts`, `src/engine/${slug}.ts`, `src/${slug}.ts`]) {
    assert.ok(
      !existsSync(join(root, wrong)),
      `"${wrong}" duplicates the pre-installed recipes/toolkit/${slug}.ts — import from recipes/toolkit/, don't copy it`,
    );
  }
}

console.log("runtime contract ok");

const vendorBundle = read("static/vendor/polyverse-content-runtime.min.js");
assert.ok(
  vendorBundle.includes("__hostEvent"),
  "vendored runtime bundle must support the host event channel (preview.state.goto/freeze)",
);
assert.ok(
  vendorBundle.includes("reportState") && vendorBundle.includes("preview.state.changed"),
  "vendored runtime bundle must support phase reporting (pv.preview.reportState -> preview.state.changed)",
);

// ── Lifecycle contract v0.2 (host-driven start/pause/resume, boot=ready) ────
assert.ok(
  vendorBundle.includes("LifecycleClient") && vendorBundle.includes("waku-lifecycle-state"),
  "vendored runtime bundle must include the lifecycle feature (pv.lifecycle + ready handshake) — re-sync static/vendor from content-runtime dist",
);
assert.ok(
  existsSync(join(root, "src/waku/lifecycle.ts")),
  "template must keep the lifecycle adapter at src/waku/lifecycle.ts",
);
assert.match(
  app,
  /useWakuLifecycle\(/,
  "src/App.tsx must wire the host lifecycle (useWakuLifecycle) — boot must land in ready, not auto-run",
);
assert.match(
  app,
  /<Stage\s+active=/,
  "src/App.tsx must gate the stage loop on the lifecycle state (<Stage active={...}>)",
);

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readManifest(source) {
  const match = source.match(
    /<script\s+type=["']application\/polyverse-manifest["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(match, "index.html must include application/polyverse-manifest");
  return JSON.parse(match[1]);
}

function readCapabilityReference(source) {
  const match = source.match(
    /<script\s+type=["']application\/json["']\s+id=["']polyverse-capability-reference["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(match, "index.html must include polyverse-capability-reference");
  assert.match(match[0], /data-reference-only=["']true["']/i);
  return JSON.parse(match[1]);
}
