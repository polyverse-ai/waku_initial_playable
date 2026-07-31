// result-card-canvas-toolkit — four zero-dependency canvas primitives that every
// hand-written per-player result/share card kept re-implementing: shrink-to-fit
// font sizing, dual-mode (CJK char / Latin word) line wrapping, a tilted circular
// ink/wax seal, and a WebP-preferred data-URL export with a PNG fallback.
//
// This is the NEUTRAL drawing layer only. The card's layout, palette, copy and
// field set are the playable's own design — keep them in the caller, pass already
// laid-out / already-localized strings in here. No DOM, no endpoints, no tokens.

export interface FitFontOpts {
  /** Lower bound; the function never returns a size below this. Default 16. */
  min?: number;
  /** Pixels shaved off each iteration until it fits. Default 4. */
  step?: number;
  /**
   * Builds the `ctx.font` string for a given size, so callers control weight and
   * family (the part that actually differs between cards). The function sets
   * `ctx.font` as it probes, leaving it at the chosen size on return.
   * Default: `700 ${size}px system-ui, sans-serif`.
   */
  font?: (size: number) => string;
}

/**
 * Returns the largest font size in [min, startSize] at which `text` fits within
 * `maxWidth`, shrinking by `step` px per probe. Side effect: leaves `ctx.font`
 * set to that size's font string, so you can `fillText` immediately after.
 */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  opts: FitFontOpts = {},
): number {
  const min = opts.min ?? 16;
  const step = opts.step ?? 4;
  const font = opts.font ?? ((s: number) => `700 ${s}px system-ui, sans-serif`);
  let size = startSize;
  ctx.font = font(size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= step;
    ctx.font = font(size);
  }
  return size;
}

export interface WrapLinesOpts {
  /**
   * `"word"` splits on whitespace (Latin), `"char"` greedily per character (CJK),
   * `"auto"` (default) picks char when the trimmed text has no whitespace, else word.
   */
  mode?: "word" | "char" | "auto";
  /** Cap the number of lines; the last line gets an ellipsis if more was dropped. */
  maxLines?: number;
}

/**
 * Greedy line-wrap measured against the CURRENT `ctx.font` (set the font before
 * calling). Handles CJK (no spaces) and spaced scripts via `mode`. With
 * `maxLines`, an overflowing final line is truncated with "…".
 */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  opts: WrapLinesOpts = {},
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const maxLines = opts.maxLines ?? Infinity;
  const mode = opts.mode ?? "auto";
  const useWord = mode === "word" || (mode === "auto" && /\s/.test(trimmed));

  const tokens = useWord ? trimmed.split(/\s+/) : [...trimmed];
  const joiner = useWord ? " " : "";
  const lines: string[] = [];
  let cur = "";

  for (const tok of tokens) {
    const next = cur ? cur + joiner + tok : tok;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = tok;
      if (lines.length >= maxLines - 1 && maxLines !== Infinity) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);

  // If we bailed early on a finite cap and content remains, ellipsize last line.
  if (maxLines !== Infinity && lines.length === maxLines && cur && lines[lines.length - 1] !== cur) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, "…");
  }
  return lines;
}

export interface SealOpts {
  x: number;
  y: number;
  /** Outer ring radius. */
  r: number;
  /** Glyph/word(s) drawn at center. Empty string draws ring(s) only. */
  text?: string;
  /** Tilt in radians (the stamped-askew look). Default -0.12. */
  angle?: number;
  /** Ring + text color. Default "#c0392b". */
  color?: string;
  /** Center text font; size auto-fits to ~1.5·r if omitted. */
  font?: string;
  /** Draw a faint translucent fill disc inside the ring. Default false. */
  fill?: boolean;
  /** Draw a second inner ring (double-stamp look). Default true. */
  doubleRing?: boolean;
  /** Outer ring line width. Default r·0.07. */
  lineWidth?: number;
}

/**
 * Draws a tilted circular seal/stamp centered at (x,y): one or two rings, an
 * optional translucent fill, and centered text auto-sized to fit the disc. Saves
 * and restores ctx; leaves textAlign/textBaseline as it found them.
 */
export function drawSeal(ctx: CanvasRenderingContext2D, opts: SealOpts): void {
  const { x, y, r } = opts;
  const angle = opts.angle ?? -0.12;
  const color = opts.color ?? "#c0392b";
  const lineWidth = opts.lineWidth ?? r * 0.07;
  const doubleRing = opts.doubleRing ?? true;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (opts.fill) {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  if (doubleRing) {
    ctx.lineWidth = Math.max(1, lineWidth * 0.45);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (opts.text) {
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontFor = (s: number) => opts.font ?? `900 ${s}px system-ui, sans-serif`;
    let size = Math.round(r * 1.5);
    ctx.font = fontFor(size);
    while (size > 12 && ctx.measureText(opts.text).width > r * 1.5) {
      size -= 4;
      ctx.font = fontFor(size);
    }
    ctx.fillText(opts.text, 0, 0);
  }

  ctx.restore();
}

/**
 * Exports a canvas to a data URL, preferring `prefer` (WebP by default → smaller,
 * faster feed loads) and falling back to PNG where the WebView can't encode it.
 * `toDataURL` silently returns PNG for an unsupported type, but some WebKit builds
 * throw on a tainted canvas — the try/catch covers both. Returns "" if the canvas
 * has no usable export path.
 */
export function toDataUrlWithFallback(
  canvas: HTMLCanvasElement,
  prefer: "image/webp" | "image/png" = "image/webp",
  quality = 0.92,
): string {
  try {
    const url = canvas.toDataURL(prefer, quality);
    // A real WebP encode yields a "data:image/webp" prefix; if the platform
    // silently downgraded, the prefix already tells the truth — return as-is.
    if (url && url.startsWith("data:image/")) return url;
  } catch {
    /* fall through to PNG */
  }
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
