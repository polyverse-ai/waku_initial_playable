import { useEffect, useRef, useState } from "react";

/**
 * Creator starts here. This is the content surface — replace the body with your
 * playable and keep the active-gated rAF shape below.
 *
 * What renders today is the starter's first screen: a title, one line saying the
 * project is alive, and a neutral three-tap loop (tap → count → done → again).
 * It calls no SDK method (so the manifest stays `"capabilities": []`), ships no
 * image, and styles itself with Tailwind utilities plus the floor's CSS
 * variables. All of it is meant to go when your content arrives.
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

const TARGET_TAPS = 3;
// Press feedback: long enough to read as a hit, short enough that quick taps
// never pile up visibly.
const HIT_MS = 160;

type Phase = "ready" | "tapping" | "done";

// Same insets as .safe-ui (src/index.css): keeps the starter clear of the host's
// top/bottom chrome and the device notch. .stage itself is full-bleed.
const SAFE_INSET = {
  top: "calc(var(--safe-top) + var(--safe-pad-top))",
  right: "calc(var(--runtime-safe-right) + var(--safe-pad-right))",
  bottom: "calc(var(--safe-bottom) + var(--safe-pad-bottom))",
  left: "calc(var(--runtime-safe-left) + var(--safe-pad-left))",
} as const;

const COPY: Record<Phase, { en: string; zh: string }> = {
  ready: {
    en: "This starter is running. Ask your AI assistant to build your playable here.",
    zh: "起始模板已经跑起来了。让你的 AI 助手在这里做出你的 playable。",
  },
  tapping: { en: "Keep going.", zh: "继续点。" },
  done: {
    en: "That's the whole loop. Now make it yours.",
    zh: "这就是完整的一轮。接下来把它换成你的作品。",
  },
};

export function Content({ active }: { active: boolean }) {
  const frameRef = useRef<number | null>(null);
  const [taps, setTaps] = useState(0);
  const [hit, setHit] = useState(false);
  const phase: Phase = taps === 0 ? "ready" : taps >= TARGET_TAPS ? "done" : "tapping";
  const remaining = TARGET_TAPS - taps;

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

  // Only a user tap starts this timer, and unmount clears it — nothing runs
  // before the first interaction.
  useEffect(() => {
    if (!hit) return;
    const timer = window.setTimeout(() => setHit(false), HIT_MS);
    return () => window.clearTimeout(timer);
  }, [hit]);

  const tap = () => {
    setHit(true);
    setTaps((n) => Math.min(TARGET_TAPS, n + 1));
  };

  // Machine-verify hook (scripts/auto-smoke.mjs, run by `npm run verify`): lets
  // the smoke prove the loop advances without a human tapping. Keep a hook of
  // this shape in your own playable — see WakuDebugHook in src/vite-env.d.ts.
  const snapshot = useRef({ phase, taps });
  snapshot.current = { phase, taps };
  useEffect(() => {
    window.__waku_debug = {
      getState: () => snapshot.current,
      step: () => setTaps((n) => Math.min(TARGET_TAPS, n + 1)),
    };
    return () => {
      delete window.__waku_debug;
    };
  }, []);

  // Static first frame — rendered at boot, no side effects.
  return (
    <div className="absolute grid place-items-center" style={SAFE_INSET} data-phase={phase}>
      <div className="grid w-full max-w-sm justify-items-center gap-6 px-4 text-center">
        <h1 className="text-sm font-semibold tracking-[0.18em] text-[var(--muted)]">
          Minimal Playable
        </h1>

        <button
          type="button"
          className={`core-target rounded-full border border-solid bg-[var(--surface)] transition-transform duration-150 ease-out ${
            hit ? "scale-90" : "scale-100"
          } ${phase === "done" ? "border-[var(--accent-strong)]" : "border-[var(--line)]"}`}
          aria-label={`Tap target, ${taps} of ${TARGET_TAPS}`}
          onPointerDown={(event) => {
            if (event.isPrimary) tap();
          }}
        >
          <span className="text-7xl font-black tabular-nums text-[var(--text)]">{taps}</span>
        </button>

        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: TARGET_TAPS }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i < taps ? "bg-[var(--accent-strong)]" : "bg-[var(--line)]"}`}
            />
          ))}
        </div>

        <div className="grid gap-2" aria-live="polite">
          <p className="text-base leading-6 text-[var(--text)]">{COPY[phase].en}</p>
          <p lang="zh-CN" className="text-sm leading-6 text-[var(--muted)]">
            {COPY[phase].zh}
          </p>
          {phase !== "done" && (
            <p className="text-xs text-[var(--muted)]">
              Tap the circle {remaining} more {remaining === 1 ? "time" : "times"} · 再点 {remaining} 次
            </p>
          )}
        </div>

        {phase === "done" && (
          <button
            type="button"
            className="rounded-full border border-solid border-[var(--line)] px-5 py-2 text-sm text-[var(--text)]"
            onClick={() => setTaps(0)}
          >
            Again · 再来一次
          </button>
        )}
      </div>
    </div>
  );
}
