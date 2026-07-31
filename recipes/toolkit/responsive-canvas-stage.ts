// responsive-canvas-stage — DPR-aware canvas stage + pointer mapping.
//
// Core rule: pointer coordinates and drawing coordinates live in the SAME
// space (CSS pixels). The backing store is sized to device pixels (cssW*dpr),
// then ctx.setTransform(dpr,...) makes every draw
// call operate in CSS pixels; toWorld() maps a pointer event to that same CSS
// space via getBoundingClientRect + (clientX - rect.left). Nothing here mixes
// device pixels with CSS pixels — that is the HiDPI "not following the finger /
// drawing off-screen" bug this component exists to prevent.
//
// Pure browser TS. No endpoint / credential. Zero runtime deps.

export interface ResponsiveCanvasOptions {
  /** Target canvas element. */
  canvas: HTMLCanvasElement;
  /** Cap on devicePixelRatio (perf guard). Default 2. */
  maxDpr?: number;
  /**
   * Called after every (re)size, in CSS pixels. Use these dims for layout —
   * NOT canvas.width/height (those are device pixels). The 2d context is
   * already set so drawing happens in this CSS-pixel space.
   */
  onResize?: (cssWidth: number, cssHeight: number, dpr: number) => void;
  /** getContext options, forwarded as-is. */
  contextAttributes?: CanvasRenderingContext2DSettings;
}

export interface ResponsiveCanvas {
  /** 2d context, already transformed so drawing is in CSS pixels. */
  ctx: CanvasRenderingContext2D;
  /**
   * Map a pointer/mouse/touch event to CSS-pixel stage coordinates —
   * the same space you draw in. Handles touch events too.
   */
  toWorld: (e: PointerEvent | MouseEvent | TouchEvent) => { x: number; y: number };
  /** Current logical width in CSS pixels. */
  readonly cssWidth: number;
  /** Current logical height in CSS pixels. */
  readonly cssHeight: number;
  /** Current (capped) devicePixelRatio in effect. */
  readonly dpr: number;
  /** Force a re-measure + resize (e.g. after a manual layout change). */
  resize: () => void;
  /** Detach observers/listeners. */
  destroy: () => void;
}

function clientXY(e: PointerEvent | MouseEvent | TouchEvent): { cx: number; cy: number } {
  const t = (e as TouchEvent).touches;
  if (t && t.length) return { cx: t[0].clientX, cy: t[0].clientY };
  const ct = (e as TouchEvent).changedTouches;
  if (ct && ct.length) return { cx: ct[0].clientX, cy: ct[0].clientY };
  const m = e as MouseEvent;
  return { cx: m.clientX, cy: m.clientY };
}

export function createResponsiveCanvas(opts: ResponsiveCanvasOptions): ResponsiveCanvas {
  const { canvas, maxDpr = 2, onResize, contextAttributes } = opts;

  const ctx = canvas.getContext('2d', contextAttributes);
  if (!ctx) throw new Error('responsive-canvas-stage: 2d context unavailable');

  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    // Fall back to attribute/offset size if the element isn't laid out yet.
    const w = rect.width || canvas.clientWidth || canvas.width || 1;
    const h = rect.height || canvas.clientHeight || canvas.height || 1;
    dpr = Math.max(1, Math.min(maxDpr, window.devicePixelRatio || 1));

    const devW = Math.round(w * dpr);
    const devH = Math.round(h * dpr);
    // Only touch the backing store when it actually changes — reassigning
    // canvas.width clears the canvas, so guard it.
    if (canvas.width !== devW) canvas.width = devW;
    if (canvas.height !== devH) canvas.height = devH;

    cssWidth = w;
    cssHeight = h;

    // Draw in CSS pixels: 1 unit == 1 CSS px, backing store is dpr× denser.
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    onResize?.(cssWidth, cssHeight, dpr);
  }

  function toWorld(e: PointerEvent | MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const { cx, cy } = clientXY(e);
    // CSS-pixel space — same space ctx draws in after setTransform(dpr,...).
    // If the element is CSS-scaled vs its layout box, normalize by rect size.
    const sx = rect.width ? cssWidth / rect.width : 1;
    const sy = rect.height ? cssHeight / rect.height : 1;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  }

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }
  const onWinResize = () => resize();
  window.addEventListener('resize', onWinResize, { passive: true });

  resize();

  return {
    ctx,
    toWorld,
    get cssWidth() {
      return cssWidth;
    },
    get cssHeight() {
      return cssHeight;
    },
    get dpr() {
      return dpr;
    },
    resize,
    destroy() {
      ro?.disconnect();
      ro = null;
      window.removeEventListener('resize', onWinResize);
    },
  };
}
