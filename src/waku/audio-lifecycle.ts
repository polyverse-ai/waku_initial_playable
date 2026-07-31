// Audio lifecycle registry: content registers each AudioContext it creates; on
// host pause we suspend them all (zero DSP/CPU while frozen) and resume them on
// return. Wire it into useWakuLifecycle({ onPause: suspendWakuAudio, onResume:
// resumeWakuAudio }). Safe with no registered contexts — every call is a no-op
// until content registers one.

const registry = new Set<AudioContext>();

// Register an AudioContext so the platform can freeze/thaw it with the lifecycle.
export function registerWakuAudioContext(ctx: AudioContext): AudioContext {
  registry.add(ctx);
  return ctx;
}

// Freeze all registered audio on host pause (releases the audio thread).
export function suspendWakuAudio(): void {
  for (const ctx of registry) {
    try {
      if (ctx.state === "running") void ctx.suspend();
    } catch {
      // a closed / broken context must not block the freeze
    }
  }
}

// Thaw all registered audio on host resume.
export function resumeWakuAudio(): void {
  for (const ctx of registry) {
    try {
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      // resume is best-effort; never throw into the lifecycle handler
    }
  }
}
