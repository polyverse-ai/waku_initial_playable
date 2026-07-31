/**
 * fixed-step-game-loop — bucket: core-loop
 *
 * A fixed-timestep main loop with a variable-rate interpolated render pass.
 * It accumulates real elapsed time, advances simulation in fixed `fixedStep`
 * chunks (deterministic physics / AI / timers), caps catch-up work with
 * `maxFrameSkip` to avoid the spiral-of-death, and hands `render` an `alpha`
 * in [0,1) describing how far the current frame sits between the last two
 * simulation steps (for smooth visual interpolation between discrete states).
 *
 * Zero game coupling: the loop owns no game state. You drive everything through
 * the `onUpdate(dt)` and `onRender(alpha)` callbacks. The clock is injectable
 * (`clockSource`) so a rhythm game can pass `() => audioCtx.currentTime * 1000`
 * to slave the simulation to the audio clock instead of `performance.now()`.
 *
 * @example
 * const loop = createFixedStepLoop({
 *   fixedStep: 1000 / 60,
 *   maxFrameSkip: 5,
 *   onUpdate: (dt) => world.step(dt),       // dt === fixedStep, in ms
 *   onRender: (alpha) => world.draw(alpha), // alpha in [0,1)
 * });
 * loop.start();
 * // ... later
 * loop.pause(); loop.resume(); loop.stop();
 */

/** A monotonic clock returning milliseconds. Defaults to `performance.now`. */
export type ClockSource = () => number;

/** A frame scheduler. Defaults to `requestAnimationFrame`. */
export type FrameScheduler = (callback: (frameTimeMs: number) => void) => number;

/** Cancels a scheduled frame. Defaults to `cancelAnimationFrame`. */
export type CancelFrame = (handle: number) => void;

export interface FixedStepLoopOptions {
  /**
   * Length of one simulation step, in milliseconds (e.g. `1000 / 60` ≈ 16.67).
   * Every `onUpdate` call receives exactly this value as `dt`. Smaller =
   * finer/steadier simulation at higher CPU cost. Required.
   */
  fixedStep: number;

  /**
   * Hard cap on how many fixed steps may run inside a single frame before the
   * loop drops the remaining backlog. Prevents the "spiral of death" when a
   * frame stalls (tab backgrounded, GC pause): without it a long gap would
   * queue hundreds of steps and the loop could never catch up. Default 5.
   */
  maxFrameSkip?: number;

  /**
   * Called once per fixed simulation step with `dt === fixedStep` (ms).
   * Put deterministic logic here: physics integration, AI, countdown timers.
   * May be called 0..maxFrameSkip times per rendered frame.
   */
  onUpdate: (dt: number) => void;

  /**
   * Called once per rendered frame with `alpha` in [0,1): the fraction of a
   * fixedStep elapsed since the last simulation step. Interpolate visual state
   * as `prev + (curr - prev) * alpha` for motion that stays smooth even when
   * the render rate and the sim rate differ. Optional.
   */
  onRender?: (alpha: number) => void;

  /**
   * Injectable monotonic millisecond clock. Pass
   * `() => audioContext.currentTime * 1000` to make the sim follow the audio
   * timeline (rhythm games). Default: `performance.now()`.
   */
  clockSource?: ClockSource;

  /** Override the frame scheduler. Default: `requestAnimationFrame`. */
  scheduler?: FrameScheduler;

  /** Override the frame canceller. Default: `cancelAnimationFrame`. */
  cancelFrame?: CancelFrame;
}

export interface FixedStepLoop {
  /** Begin (or restart after stop) the loop. No-op if already running. */
  start(): void;
  /** Stop and reset the accumulator. The loop can be `start()`ed fresh again. */
  stop(): void;
  /** Pause: keep state but stop scheduling frames; time gap is discarded on resume. */
  pause(): void;
  /** Resume after pause without producing a catch-up burst. No-op if not paused. */
  resume(): void;
  /**
   * Run exactly one fixed step immediately, regardless of real time, then
   * render at alpha 0. Useful for debugging / a "single-step" button. Works
   * while paused or stopped.
   */
  step(): void;
  /** True while frames are being scheduled (not paused, not stopped). */
  readonly running: boolean;
  /** True while paused (started but frames suspended). */
  readonly paused: boolean;
  /** Total fixed steps executed since the last `start()`. */
  readonly stepCount: number;
}

const defaultClock: ClockSource = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Create a fixed-step loop. Returns a handle with start/stop/pause/resume/step.
 * The loop does not auto-start; call `start()`.
 */
export function createFixedStepLoop(options: FixedStepLoopOptions): FixedStepLoop {
  const {
    fixedStep,
    onUpdate,
    onRender,
    maxFrameSkip = 5,
    clockSource = defaultClock,
    scheduler = (cb) => requestAnimationFrame(cb),
    cancelFrame = (h) => cancelAnimationFrame(h),
  } = options;

  if (!(fixedStep > 0)) throw new Error("fixedStep must be a positive number of milliseconds");
  if (!(maxFrameSkip >= 1)) throw new Error("maxFrameSkip must be >= 1");

  let running = false;
  let paused = false;
  let rafHandle: number | null = null;
  let lastTime = 0;
  let accumulator = 0;
  let stepCount = 0;

  const frame = () => {
    if (!running || paused) return;

    const nowMs = clockSource();
    let frameTime = nowMs - lastTime;
    lastTime = nowMs;

    // Clamp the consumable time to maxFrameSkip steps. Anything beyond is
    // dropped here so the accumulator can never build an unrecoverable backlog.
    const maxFrameTime = fixedStep * maxFrameSkip;
    if (frameTime > maxFrameTime) frameTime = maxFrameTime;
    if (frameTime < 0) frameTime = 0; // clock went backwards (e.g. injected clock reset)

    accumulator += frameTime;

    while (accumulator >= fixedStep) {
      onUpdate(fixedStep);
      accumulator -= fixedStep;
      stepCount++;
    }

    // Fraction into the next pending step, for visual interpolation.
    const alpha = accumulator / fixedStep;
    onRender?.(alpha);

    rafHandle = scheduler(frame);
  };

  const schedule = () => {
    lastTime = clockSource();
    rafHandle = scheduler(frame);
  };

  const cancel = () => {
    if (rafHandle != null) {
      cancelFrame(rafHandle);
      rafHandle = null;
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      paused = false;
      accumulator = 0;
      stepCount = 0;
      schedule();
    },
    stop() {
      running = false;
      paused = false;
      accumulator = 0;
      cancel();
    },
    pause() {
      if (!running || paused) return;
      paused = true;
      cancel();
    },
    resume() {
      if (!running || !paused) return;
      paused = false;
      // Reset the clock anchor so the paused gap is not replayed as catch-up.
      schedule();
    },
    step() {
      onUpdate(fixedStep);
      stepCount++;
      onRender?.(0);
    },
    get running() {
      return running && !paused;
    },
    get paused() {
      return paused;
    },
    get stepCount() {
      return stepCount;
    },
  };
}
