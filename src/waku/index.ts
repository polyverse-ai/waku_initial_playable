// Waku floor barrel — the single import surface for content. Content should only
// ever `import { ... } from "../waku"`, never reach into individual modules.

// Runtime handshake + platform client types (from ./polyverse).
export { readyWakuRuntime } from "./polyverse";
export type { WakuPlatformClient, WakuCapability } from "./polyverse";

// Host-driven lifecycle (contract v0.2): boot=ready, host sends start/pause/resume.
export { useWakuLifecycle } from "./lifecycle";
export type { WakuLifecycleState } from "./lifecycle";

// Safe-area / z-layer primitives (compose these instead of raw class names).
export { BgLayer, Stage, SafeUI } from "./safe-area";

// Audio lifecycle registry (freeze/thaw AudioContexts with the host lifecycle).
export { registerWakuAudioContext, suspendWakuAudio, resumeWakuAudio } from "./audio-lifecycle";
