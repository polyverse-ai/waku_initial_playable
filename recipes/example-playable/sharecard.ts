// Generic per-player result-card renderer for the share-to-comments path.
//
// Why this exists: the platform's only share channel (app.comment.compose) posts
// to the comment area, and its host-side classifier accepts an IMAGE comment only
// for a fetchable http(s) URL. So "share the player's result as a picture" means:
// render THIS run to a canvas → upload the image → post the returned URL. This
// helper is the render half — a neutral, theme-driven card any generated playable
// can fill with its own three fields. Pair it with uploadImageForShare() in
// ../waku/polyverse.ts. Math/numbers are language-neutral; pass already-localized
// strings in.
//
// Keep it OPTIONAL: the default share is text-only (see DefaultPlayable). Reach
// for a card only when a per-player image genuinely adds something — never to
// post a bundled decorative asset dressed up as a result.

export interface ResultCardInput {
  /** Small kicker over the stat, e.g. a localized "Result". */
  title: string;
  /** The one big number/word that IS the result, e.g. "3.4s" or the score. */
  stat: string;
  /** One supporting line under the stat, e.g. a localized tagline. */
  caption: string;
}

// Reads a theme token off :root so the card tracks the app's palette without a
// second source of truth. Falls back to a sane dark value if the var is unset.
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Renders the card to a data URL (1080×1080). Prefers WebP (smaller → less
 * bandwidth/storage, faster feed load); falls back to PNG automatically where the
 * WebView can't encode WebP. Returns "" if no 2D context.
 */
export function renderResultCard({ title, stat, caption }: ResultCardInput): string {
  const S = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const bg = token("--bg", "oklch(13% 0.01 240)");
  const surface = token("--surface-strong", "oklch(24% 0.018 240)");
  const text = token("--text", "oklch(94% 0.012 250)");
  const muted = token("--muted", "oklch(72% 0.018 248)");
  const accent = token("--accent-strong", "oklch(78% 0.14 220)");

  // background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // centered surface panel
  const pad = 96;
  const r = 56;
  const x = pad;
  const y = pad;
  const w = S - pad * 2;
  const h = S - pad * 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = surface;
  ctx.fill();

  ctx.textAlign = "center";

  // title kicker
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent;
  ctx.font = '700 44px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(title.toUpperCase(), S / 2, S * 0.36);

  // the big stat (shrink to fit)
  ctx.fillStyle = text;
  let statSize = 240;
  ctx.font = `900 ${statSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  while (ctx.measureText(stat).width > w - 120 && statSize > 64) {
    statSize -= 8;
    ctx.font = `900 ${statSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  ctx.fillText(stat, S / 2, S * 0.56);

  // caption (shrink to fit)
  ctx.fillStyle = muted;
  let capSize = 46;
  ctx.font = `500 ${capSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  while (ctx.measureText(caption).width > w - 120 && capSize > 24) {
    capSize -= 2;
    ctx.font = `500 ${capSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  ctx.fillText(caption, S / 2, S * 0.7);

  // toDataURL silently ignores an unsupported type and returns PNG, so this yields
  // WebP where the WebView can encode it (Android/Chromium) and PNG where it can't
  // (some iOS WebKit builds). The mime prefix of the returned string tells the truth;
  // uploadImageForShare reads it back so the bytes are always labeled correctly.
  return canvas.toDataURL("image/webp", 0.92);
}
