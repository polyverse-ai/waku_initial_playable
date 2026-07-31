/**
 * juice-fx-layer — unified juice/feedback expression layer
 *
 * Zero game-coupling: drives screen shake, hit flash, float text,
 * slow-motion, and particle bursts via preset or explicit params.
 * Mount one instance per game, call trigger methods on events.
 *
 * Usage:
 *   const fx = createJuiceFxLayer({ container, presets, hapticsEnabled })
 *   fx.trigger('hit')           // fire named preset
 *   fx.screenShake({ amp: 12 }) // or call primitives directly
 *   fx.destroy()                // cleanup on unmount
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScreenShakeOptions {
  /** Peak displacement in px (default 8) */
  amp?: number;
  /** Decay factor per frame 0–1 (default 0.88) */
  decay?: number;
  /** Duration cap ms (default 600) */
  durationMs?: number;
}

export interface FloatTextOptions {
  text: string;
  /** Absolute px position on the container — pass event coords */
  x: number;
  y: number;
  /** CSS color string (default accent from CSS var) */
  color?: string;
  /** Font size px (default 28) */
  fontSize?: number;
  /** Rise distance px (default 80) */
  riseBy?: number;
  /** Animation duration ms (default 900) */
  durationMs?: number;
}

export interface ParticleBurstOptions {
  /** Number of particles (default 24) */
  count?: number;
  /** Hex/CSS color list — cycled (default confetti palette) */
  colors?: string[];
  /** Gravity acceleration px/ms² (default 0.0004) */
  gravity?: number;
  /** Half-angle spread in degrees (default 180 = full circle) */
  spread?: number;
  /** Origin x px relative to container (default center) */
  x?: number;
  /** Origin y px relative to container (default center) */
  y?: number;
  /** Particle shape: 'rect' | 'circle' | 'foil' (default 'rect') */
  shape?: "rect" | "circle" | "foil";
  /** Initial speed px/ms (default 0.5) */
  speed?: number;
  /** Particle size px (default 8) */
  size?: number;
  /** Fade-out duration ms (default 1200) */
  durationMs?: number;
}

export interface SlowMotionOptions {
  /** Time scale factor 0–1 (default 0.25) */
  factor?: number;
  /** Duration in real-time ms (default 800) */
  durationMs?: number;
}

export interface HitFlashOptions {
  /** CSS color for flash overlay (default white) */
  color?: string;
  /** Flash opacity 0–1 (default 0.35) */
  opacity?: number;
  /** Fade duration ms (default 180) */
  durationMs?: number;
}

/** Named preset — all keys optional, merged over defaults */
export interface JuicePreset {
  screenShake?: ScreenShakeOptions;
  hitFlash?: HitFlashOptions;
  particleBurst?: ParticleBurstOptions;
  floatText?: Omit<FloatTextOptions, "x" | "y" | "text"> & {
    /** Text template — use '{score}' placeholder when driven by score */
    textTemplate?: string;
  };
  slowMotion?: SlowMotionOptions;
}

export type PresetName = string;

export interface JuiceFxLayerOptions {
  /** DOM container that receives the canvas overlay (fills it via position:absolute) */
  container: HTMLElement;
  /** Named presets — extend or override the built-in ones */
  presets?: Record<PresetName, JuicePreset>;
  /** Master intensity multiplier applied to amp/count/opacity (default 1) */
  intensity?: number;
  /** Enable navigator.vibrate calls (default false) */
  hapticsEnabled?: boolean;
  /**
   * Optional seeded random source — inject for deterministic tests.
   * Must return a value in [0, 1).
   * Defaults to Math.random.
   */
  random?: () => number;
  /**
   * Callback invoked on each slow-motion tick with current timescale.
   * Use this to slow down game physics/animation loops.
   */
  onSlowMotionTick?: (factor: number) => void;
}

// ─── Built-in presets ────────────────────────────────────────────────────────

const BUILTIN_PRESETS: Record<string, JuicePreset> = {
  hit: {
    screenShake: { amp: 6, decay: 0.85, durationMs: 350 },
    hitFlash: { color: "#ffffff", opacity: 0.28, durationMs: 160 },
  },
  combo: {
    screenShake: { amp: 10, decay: 0.82, durationMs: 500 },
    hitFlash: { color: "#ffe066", opacity: 0.38, durationMs: 200 },
    particleBurst: {
      count: 30,
      colors: ["#ffe066", "#ffb020", "#fff", "#ff8800"],
      shape: "rect",
      gravity: 0.0005,
      spread: 120,
      speed: 0.55,
    },
    floatText: { textTemplate: "COMBO!", color: "#ffe066", fontSize: 34, riseBy: 90 },
  },
  burst: {
    particleBurst: {
      count: 48,
      colors: ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c77dff"],
      shape: "rect",
      gravity: 0.0004,
      spread: 180,
      speed: 0.6,
      size: 9,
    },
    screenShake: { amp: 8, decay: 0.84, durationMs: 450 },
  },
  gold: {
    particleBurst: {
      count: 40,
      colors: ["#ffd700", "#ffec80", "#b8860b", "#fffacd"],
      shape: "foil",
      gravity: 0.00025,
      spread: 160,
      speed: 0.45,
      size: 11,
    },
    hitFlash: { color: "#ffd700", opacity: 0.22, durationMs: 220 },
  },
  debris: {
    particleBurst: {
      count: 20,
      colors: ["#888", "#aaa", "#555", "#ccc"],
      shape: "rect",
      gravity: 0.0007,
      spread: 100,
      speed: 0.7,
      size: 6,
    },
    screenShake: { amp: 14, decay: 0.80, durationMs: 600 },
  },
  bubble: {
    particleBurst: {
      count: 18,
      colors: ["rgba(120,220,255,0.7)", "rgba(180,240,255,0.6)", "rgba(80,190,255,0.5)"],
      shape: "circle",
      gravity: -0.00015,
      spread: 180,
      speed: 0.3,
      size: 14,
      durationMs: 1600,
    },
  },
  slowmo: {
    slowMotion: { factor: 0.2, durationMs: 1000 },
    hitFlash: { color: "#88ccff", opacity: 0.15, durationMs: 300 },
  },
};

// ─── Particle internal state ──────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  shape: "rect" | "circle" | "foil";
  born: number;
  durationMs: number;
  gravity: number;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface JuiceFxLayer {
  /**
   * Fire a named preset.
   * @param name Preset key — built-in or user-defined
   * @param overrides Per-call overrides merged on top of the preset
   * @param textVars Template variables for floatText.textTemplate (e.g. {score:'42'})
   * @param origin Optional {x,y} in container-relative px for positioned effects
   */
  trigger(
    name: PresetName,
    overrides?: Partial<JuicePreset>,
    textVars?: Record<string, string>,
    origin?: { x: number; y: number },
  ): void;

  /** Raw primitive: screen shake */
  screenShake(opts?: ScreenShakeOptions): void;

  /** Raw primitive: hit flash overlay */
  hitFlash(opts?: HitFlashOptions): void;

  /** Raw primitive: float text pop */
  floatText(opts: FloatTextOptions): void;

  /** Raw primitive: slow-motion effect */
  slowMotion(opts?: SlowMotionOptions): void;

  /** Raw primitive: particle burst */
  particleBurst(opts?: ParticleBurstOptions): void;

  /** Change master intensity multiplier (0–2) */
  setIntensity(value: number): void;

  /** Toggle haptics */
  setHapticsEnabled(enabled: boolean): void;

  /** Get current slow-motion timescale (1 = normal, <1 = slow) */
  getTimescale(): number;

  /** Remove canvas, stop RAF loop */
  destroy(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createJuiceFxLayer(options: JuiceFxLayerOptions): JuiceFxLayer {
  const {
    container,
    intensity: initIntensity = 1,
    hapticsEnabled: initHaptics = false,
    random = Math.random,
    onSlowMotionTick,
  } = options;

  const mergedPresets: Record<string, JuicePreset> = {
    ...BUILTIN_PRESETS,
    ...options.presets,
  };

  // ── Canvas overlay ────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
  // Only establish a positioning context if the container is statically positioned.
  // Never clobber an existing fixed/absolute/relative (esp. .stage's class-set
  // position:fixed): blindly setting inline "relative" collapsed it to 0 height and
  // blanked the canvas — a recurring trap. Read computed, not inline.
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  // ── State ─────────────────────────────────────────────────────────────────
  let intensity = initIntensity;
  let hapticsEnabled = initHaptics;
  let destroyed = false;

  // Screen shake
  let shakeAmp = 0;
  let shakeDecay = 0.88;
  let shakeEndTime = 0;
  let shakeOffsetX = 0;
  let shakeOffsetY = 0;

  // Hit flash overlay
  let flashColor = "#fff";
  let flashOpacity = 0;
  let flashDecay = 0;
  let flashEndTime = 0;

  // Slow motion
  let timescale = 1;
  let slowEndTime = 0;
  let slowTargetFactor = 1;
  let slowOriginalFactor = 1;

  // Particles
  const particles: Particle[] = [];

  // Float text DOM elements (CSS animation, no canvas needed)
  // Managed separately as DOM nodes so they inherit font stack

  // ── Resize canvas ─────────────────────────────────────────────────────────
  function syncSize() {
    const rect = container.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
  }

  const resizeObserver = new ResizeObserver(syncSize);
  resizeObserver.observe(container);
  syncSize();

  // ── RAF loop ──────────────────────────────────────────────────────────────
  let lastTs = 0;
  let rafId = 0;

  function tick(ts: number) {
    if (destroyed) return;
    const dt = lastTs ? Math.min(ts - lastTs, 64) : 16;
    lastTs = ts;

    syncSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = ts;

    // ── Slow-motion ──────────────────────────────────────────────────────
    if (timescale < 1) {
      if (now >= slowEndTime) {
        timescale = 1;
      }
      onSlowMotionTick?.(timescale);
    }

    // ── Screen shake ─────────────────────────────────────────────────────
    if (shakeAmp > 0.3 && now < shakeEndTime) {
      shakeOffsetX = (random() * 2 - 1) * shakeAmp;
      shakeOffsetY = (random() * 2 - 1) * shakeAmp;
      shakeAmp *= shakeDecay;
      container.style.transform = `translate(${shakeOffsetX}px,${shakeOffsetY}px)`;
    } else if (shakeAmp > 0) {
      shakeAmp = 0;
      shakeOffsetX = 0;
      shakeOffsetY = 0;
      container.style.transform = "";
    }

    // ── Hit flash ────────────────────────────────────────────────────────
    if (flashOpacity > 0.005) {
      flashOpacity *= flashDecay;
      ctx.fillStyle = flashColor;
      ctx.globalAlpha = Math.min(flashOpacity, 1);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    // ── Particles ────────────────────────────────────────────────────────
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = now - p.born;
      if (age >= p.durationMs) {
        particles.splice(i, 1);
        continue;
      }
      // Update
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.rotation += p.rotationSpeed * dt;
      p.alpha = 1 - age / p.durationMs;

      // Draw
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "foil") {
        // Shiny gold foil — elongated rect with shimmer
        const w = p.size * 1.5;
        const h = p.size * 0.5;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillRect(-w / 2, -h / 2, w * 0.4, h);
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  // ── Primitives ────────────────────────────────────────────────────────────

  function doScreenShake(opts: ScreenShakeOptions = {}) {
    const amp = (opts.amp ?? 8) * intensity;
    if (amp <= 0) return;
    shakeAmp = Math.max(shakeAmp, amp);
    shakeDecay = opts.decay ?? 0.88;
    shakeEndTime = performance.now() + (opts.durationMs ?? 600);
    if (hapticsEnabled) navigator.vibrate?.([30]);
  }

  function doHitFlash(opts: HitFlashOptions = {}) {
    flashColor = opts.color ?? "#ffffff";
    flashOpacity = Math.min((opts.opacity ?? 0.35) * intensity, 1);
    const dur = opts.durationMs ?? 180;
    // Decay per frame at ~60fps
    flashDecay = Math.pow(0.01, 1 / (dur / 16));
    flashEndTime = performance.now() + dur;
  }

  function doFloatText(opts: FloatTextOptions) {
    const el = document.createElement("div");
    const fontSize = (opts.fontSize ?? 28) * Math.sqrt(intensity);
    const riseBy = (opts.riseBy ?? 80) * intensity;
    const dur = opts.durationMs ?? 900;
    el.textContent = opts.text;
    el.style.cssText = `
      position:absolute;
      left:${opts.x}px;
      top:${opts.y}px;
      transform:translate(-50%,-50%);
      font-size:${fontSize}px;
      font-weight:900;
      color:${opts.color ?? "var(--accent-strong, #88ccff)"};
      pointer-events:none;
      z-index:10000;
      text-shadow:0 2px 8px rgba(0,0,0,0.5);
      animation:jfx-float ${dur}ms ease-out forwards;
      --jfx-rise:${riseBy}px;
    `;
    container.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }

  function doSlowMotion(opts: SlowMotionOptions = {}) {
    slowTargetFactor = opts.factor ?? 0.25;
    slowOriginalFactor = timescale;
    slowEndTime = performance.now() + (opts.durationMs ?? 800);
    timescale = slowTargetFactor;
  }

  function doParticleBurst(opts: ParticleBurstOptions = {}) {
    const count = Math.round((opts.count ?? 24) * intensity);
    const colors = opts.colors ?? ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c77dff"];
    const gravity = opts.gravity ?? 0.0004;
    const spread = ((opts.spread ?? 180) * Math.PI) / 180;
    const cx = opts.x ?? canvas.width / 2;
    const cy = opts.y ?? canvas.height / 2;
    const shape = opts.shape ?? "rect";
    const speed = (opts.speed ?? 0.5) * intensity;
    const size = (opts.size ?? 8) * Math.sqrt(intensity);
    const dur = opts.durationMs ?? 1200;
    const now = performance.now();

    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (random() - 0.5) * spread;
      const v = speed * (0.5 + random() * 0.8);
      particles.push({
        x: cx + (random() - 0.5) * 10,
        y: cy + (random() - 0.5) * 10,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        color: colors[Math.floor(random() * colors.length)],
        alpha: 1,
        size: size * (0.6 + random() * 0.8),
        rotation: random() * Math.PI * 2,
        rotationSpeed: (random() - 0.5) * 0.02,
        shape,
        born: now,
        durationMs: dur * (0.7 + random() * 0.6),
        gravity,
      });
    }
  }

  // ── CSS keyframe injection ────────────────────────────────────────────────
  if (!document.getElementById("jfx-keyframes")) {
    const style = document.createElement("style");
    style.id = "jfx-keyframes";
    style.textContent = `
      @keyframes jfx-float {
        0%   { opacity: 1; transform: translate(-50%, -50%); }
        100% { opacity: 0; transform: translate(-50%, calc(-50% - var(--jfx-rise, 80px))); }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function trigger(
    name: PresetName,
    overrides: Partial<JuicePreset> = {},
    textVars: Record<string, string> = {},
    origin?: { x: number; y: number },
  ) {
    const base = mergedPresets[name] ?? {};
    const preset: JuicePreset = {
      screenShake: overrides.screenShake ?? base.screenShake,
      hitFlash: overrides.hitFlash ?? base.hitFlash,
      particleBurst: overrides.particleBurst ?? base.particleBurst,
      floatText: overrides.floatText ?? base.floatText,
      slowMotion: overrides.slowMotion ?? base.slowMotion,
    };

    if (preset.screenShake) doScreenShake(preset.screenShake);
    if (preset.hitFlash) doHitFlash(preset.hitFlash);
    if (preset.slowMotion) doSlowMotion(preset.slowMotion);

    if (preset.particleBurst) {
      doParticleBurst({
        ...preset.particleBurst,
        x: origin?.x ?? preset.particleBurst.x,
        y: origin?.y ?? preset.particleBurst.y,
      });
    }

    if (preset.floatText && origin) {
      let text = preset.floatText.textTemplate ?? name.toUpperCase() + "!";
      for (const [k, v] of Object.entries(textVars)) {
        text = text.replace(`{${k}}`, v);
      }
      doFloatText({ ...preset.floatText, text, x: origin.x, y: origin.y });
    }
  }

  return {
    trigger,
    screenShake: doScreenShake,
    hitFlash: doHitFlash,
    floatText: doFloatText,
    slowMotion: doSlowMotion,
    particleBurst: doParticleBurst,
    setIntensity(v: number) {
      intensity = Math.max(0, Math.min(v, 2));
    },
    setHapticsEnabled(v: boolean) {
      hapticsEnabled = v;
    },
    getTimescale() {
      return timescale;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      canvas.remove();
      container.style.transform = "";
    },
  };
}
