// Design-canvas uniform scaling.
//
// The host shows playables full-screen on the device, and across phone models we
// just let the layout reflow (different screens are not our problem). But some
// host surfaces — notably the edit / card presentation — shrink the webview
// frame PROPORTIONALLY (same aspect ratio, smaller box). There we don't want the
// content to reflow into the smaller frame; we want the whole playable to scale
// down as one piece, a faithful miniature.
//
// So we treat the largest viewport ever observed as the design size, lay the
// content out at that size on #root, and uniformly transform-scale #root to fit
// the current (possibly shrunk) viewport. Full-screen → scale 1 (unchanged,
// full-bleed). A proportional shrink → a smaller, identical-looking copy.

let installed = false;

export function installViewportScale(
  root: HTMLElement | null = document.getElementById("root"),
): void {
  if (installed || !root) return;
  installed = true;

  // Reference = the largest viewport seen so far (the device's full-screen size).
  // It only grows, so once the full screen is observed once the scale is exact;
  // before that (e.g. loaded straight into a shrunk card) we fall back to scale 1.
  let refW = 0;
  let refH = 0;

  const apply = () => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (w > refW) refW = w;
    if (h > refH) refH = h;
    // A proportional shrink keeps the aspect ratio, so w/refW === h/refH; min()
    // keeps the canvas fully contained for any off-aspect case. Never upscale.
    const scale = Math.min(1, w / refW, h / refH);
    root.style.setProperty("--app-w", `${refW}px`);
    root.style.setProperty("--app-h", `${refH}px`);
    root.style.setProperty("--app-scale", `${scale}`);
  };

  apply();
  // documentElement reflects the webview frame, independent of #root's own size.
  new ResizeObserver(apply).observe(document.documentElement);
  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", apply, { passive: true });
}
