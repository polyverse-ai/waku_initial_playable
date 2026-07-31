// Robust device tilt + shake controller for mobile-WebView playables.
// Reads DeviceOrientation (tilt) and DeviceMotion (shake), normalizes tilt to a
// stable axis in [-1,1] with neutral calibration, EMA smoothing and a deadzone.
// Handles the iOS permission gate and falls back to pointer drag when no sensor
// frames arrive (desktop, or sensors blocked). Additive: never throws when
// sensors are absent — content using it still works, just without tilt.

export type TiltSource = "sensor" | "pointer" | "none";

export interface TiltOptions {
  rangeDeg?: number; // tilt angle (from neutral) mapped to full -1..1 (default 30)
  ema?: number; // smoothing factor 0..1, higher = snappier (default 0.18)
  deadzone?: number; // ignore |axis| below this (default 0.04)
  shakeG?: number; // shake trigger, in g above gravity (default 1.7)
  watchdogMs?: number; // no sensor frame within this → pointer fallback (default 800)
  onTilt?: (x: number, y: number) => void; // x = left/right, y = front/back
  onShake?: () => void;
  onSource?: (source: TiltSource) => void;
}

export interface TiltController {
  start(): void;
  stop(): void;
  // Call from a real user gesture (tap) on iOS 13+; resolves true if granted.
  requestPermission(): Promise<boolean>;
  recalibrate(): void; // set the current pose as the new neutral
  destroy(): void;
  readonly source: TiltSource;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function createTiltController(opts: TiltOptions = {}): TiltController {
  const rangeDeg = opts.rangeDeg ?? 30;
  const ema = opts.ema ?? 0.18;
  const deadzone = opts.deadzone ?? 0.04;
  const shakeG = opts.shakeG ?? 1.7;
  const watchdogMs = opts.watchdogMs ?? 800;

  let source: TiltSource = "none";
  let baseBeta: number | null = null; // neutral pose, captured on first frame / recalibrate
  let baseGamma: number | null = null;
  let sx = 0;
  let sy = 0; // smoothed axis
  let lastFrame = 0;
  let lastShake = 0;
  let watchdog = 0;
  let running = false;

  const setSource = (s: TiltSource) => {
    if (s === source) return;
    source = s;
    opts.onSource?.(s);
  };

  const emit = (x: number, y: number) => {
    sx += ema * (x - sx);
    sy += ema * (y - sy);
    const dz = (v: number) => (Math.abs(v) < deadzone ? 0 : v);
    opts.onTilt?.(dz(sx), dz(sy));
  };

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    lastFrame = Date.now();
    setSource("sensor");
    if (baseBeta == null) {
      baseBeta = e.beta;
      baseGamma = e.gamma;
    }
    const x = clamp((e.gamma - (baseGamma ?? 0)) / rangeDeg, -1, 1);
    const y = clamp((e.beta - baseBeta) / rangeDeg, -1, 1);
    emit(x, y);
  };

  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const g = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) / 9.81; // ~1 at rest
    const now = Date.now();
    if (g > shakeG && now - lastShake > 600) {
      lastShake = now;
      opts.onShake?.();
    }
  };

  // Pointer fallback: drag anywhere maps to the axis, for desktop / no-sensor.
  let dragging = false;
  let ox = 0;
  let oy = 0;
  const PX = 120; // drag distance mapped to full -1..1
  const onDown = (e: PointerEvent) => {
    if (source === "sensor") return;
    dragging = true;
    ox = e.clientX;
    oy = e.clientY;
    setSource("pointer");
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    emit(clamp((e.clientX - ox) / PX, -1, 1), clamp((e.clientY - oy) / PX, -1, 1));
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    emit(0, 0); // spring back to neutral on release
  };

  const requestPermission = async (): Promise<boolean> => {
    const Ctor = window.DeviceOrientationEvent as OrientationCtor | undefined;
    if (Ctor && typeof Ctor.requestPermission === "function") {
      try {
        return (await Ctor.requestPermission()) === "granted";
      } catch {
        return false;
      }
    }
    return true; // Android / desktop: no gate
  };

  const start = () => {
    if (running) return;
    running = true;
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    watchdog = window.setInterval(() => {
      if (source !== "sensor") return;
      if (Date.now() - lastFrame > watchdogMs) setSource("pointer"); // sensor went quiet
    }, watchdogMs);
  };

  const stop = () => {
    if (!running) return;
    running = false;
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.clearInterval(watchdog);
  };

  return {
    start,
    stop,
    requestPermission,
    recalibrate: () => {
      baseBeta = null;
      baseGamma = null;
    },
    destroy: stop,
    get source() {
      return source;
    },
  };
}
