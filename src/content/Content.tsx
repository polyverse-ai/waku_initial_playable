import { useEffect, useRef } from "react";

/**
 * Creator starts here. This is the near-blank content surface — replace the body
 * with your playable and keep the active-gated rAF shape below.
 *
 * CPU / memory-safe pattern (the Web Container freezes idle content):
 *   1. Boot draws ONLY a static first frame with zero running side effects — no
 *      rAF, timer, sensor, audio or network kicks off on mount.
 *   2. Every loop (rAF / setInterval / sensor listener) is GATED on `active`
 *      (host lifecycle === "running"); nothing runs while ready or paused.
 *   3. On pause (active → false) cancel the rAF, release heavy buffers, and
 *      lazy-load big assets only on demand — a backgrounded playable costs zero.
 *
 * `active` is true only while the host says "running".
 */
export function Content({ active }: { active: boolean }) {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return; // ready / paused: schedule nothing, burn zero CPU
    const tick = () => {
      // Per-frame work goes here — this only runs while active.
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      // active → false (or unmount): cancel the loop so the frame freezes.
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [active]);

  // Static first frame — rendered at boot, no side effects.
  return <p className="content-first-frame">Ready</p>;
}
