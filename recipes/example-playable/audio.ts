// Web Audio manager: BGM is a singleton; SFX playback is duration-bound.
// The default tracks are synthesized locally so the template ships no placeholder audio files.

export const SFX_DURATIONS = Object.freeze({
  tap: 0.18,
  complete: 0.72,
  timeout: 0.46,
});

type TrackKind = "bgm" | "sfx";
type TrackVariant = "pulse" | "resolve" | "low" | "tone";

interface Track {
  kind: TrackKind;
  duration?: number;
  frequency: number;
  volume: number;
  variant: TrackVariant;
}

interface CurrentBgm {
  id: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface AudioEventRecord extends Record<string, unknown> {
  type: string;
  at: number;
}

const BGM_DURATION_SECONDS = 12.5;
const FADE_SECONDS = 0.06;

const tracks = new Map<string, Track>();
let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let currentBgm: CurrentBgm | null = null;
let muted = false;
const audioEvents: AudioEventRecord[] = [];

export function installDefaultAudioSet() {
  register("loop", { kind: "bgm", frequency: 174, volume: 0.16, variant: "pulse" });
  register("result", { kind: "bgm", frequency: 261.63, volume: 0.14, variant: "resolve" });
  register("fail", { kind: "bgm", frequency: 123.47, volume: 0.1, variant: "low" });
  register("tap", { kind: "sfx", duration: SFX_DURATIONS.tap, frequency: 740, volume: 0.24 });
  register("complete", { kind: "sfx", duration: SFX_DURATIONS.complete, frequency: 523.25, volume: 0.28 });
  register("timeout", { kind: "sfx", duration: SFX_DURATIONS.timeout, frequency: 196, volume: 0.2 });
}

export function register(
  id: string,
  { kind = "sfx", duration, frequency = 440, volume = 1, variant = "tone" }: Partial<Track> & Pick<Track, "kind">,
) {
  tracks.set(id, { kind, duration, frequency, volume, variant });
}

export function setMuted(value: boolean) {
  muted = value;
  if (masterGain) masterGain.gain.value = muted ? 0 : 1;
}

export function playBgm(id: string) {
  const track = tracks.get(id);
  if (!track || track.kind !== "bgm") return null;
  const ctx = ensureContext();
  if (!ctx || !masterGain) return null;
  resumeContext(ctx);
  stopBgm();

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = makeBgmBuffer(ctx, track);
  source.loop = true;
  gain.gain.setValueAtTime(track.volume, ctx.currentTime);
  source.connect(gain).connect(masterGain);
  source.start(ctx.currentTime);
  pushAudioEvent("bgm-start", {
    id,
    bufferDuration: Number(source.buffer.duration.toFixed(3)),
    activeBgm: 1,
  });
  currentBgm = { id, source, gain };
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  return source;
}

export function stopBgm() {
  if (!currentBgm || !audioContext) return;
  const { source, gain } = currentBgm;
  const now = audioContext.currentTime;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS);
    source.stop(now + FADE_SECONDS);
    pushAudioEvent("bgm-stop", {
      id: currentBgm.id,
      stopDelay: Number(FADE_SECONDS.toFixed(3)),
      activeBgm: 0,
    });
  } catch {
    // BGM stop is best-effort; source may already have ended during a fast reset.
  }
  currentBgm = null;
}

export function playSfx(id: keyof typeof SFX_DURATIONS | string) {
  const track = tracks.get(id);
  if (!track || track.kind !== "sfx") return null;
  const ctx = ensureContext();
  if (!ctx || !masterGain) return null;
  resumeContext(ctx);

  const fallbackDuration = id in SFX_DURATIONS ? SFX_DURATIONS[id as keyof typeof SFX_DURATIONS] : 0.5;
  const duration = Number(track.duration || fallbackDuration);
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = makeSfxBuffer(ctx, track, duration);
  gain.gain.setValueAtTime(track.volume, now);
  gain.gain.setValueAtTime(track.volume, now + Math.max(0, duration - FADE_SECONDS));
  gain.gain.linearRampToValueAtTime(0.0001, now + duration);
  source.connect(gain).connect(masterGain);
  source.start(now, 0, duration);
  source.stop(now + duration + 0.05);
  pushAudioEvent("sfx-start", {
    id,
    startOffset: 0,
    startDuration: Number(duration.toFixed(3)),
    stopDelay: Number((duration + 0.05).toFixed(3)),
  });
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  return source;
}

// Lifecycle pause/resume: suspending the AudioContext freezes BGM in place
// (lossless — the exact playback position resumes), which is precisely the
// contract's pause semantics. Both are safe no-ops when no context exists yet.
export function suspendAudio() {
  if (audioContext && audioContext.state === "running") {
    void audioContext.suspend().catch(() => {});
    pushAudioEvent("ctx-suspend", { reason: "lifecycle-pause" });
  }
}

export function resumeAudio() {
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
    pushAudioEvent("ctx-resume", { reason: "lifecycle-resume" });
  }
}

export function getAudioDebugState() {
  return {
    currentBgmId: currentBgm?.id || null,
    contextState: audioContext?.state ?? "none",
    muted,
    registered: [...tracks.keys()],
    sfxDurations: { ...SFX_DURATIONS },
    events: [...audioEvents],
  };
}

function ensureContext() {
  const AudioCtor = globalThis.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) {
    audioContext = new AudioCtor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

function resumeContext(ctx: AudioContext) {
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
}

function makeBgmBuffer(ctx: AudioContext, track: Track) {
  const length = Math.ceil(ctx.sampleRate * BGM_DURATION_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const base = track.frequency;
  for (let i = 0; i < length; i += 1) {
    const t = i / ctx.sampleRate;
    const pulse = track.variant === "resolve" ? 0.62 : track.variant === "low" ? 0.38 : 0.5;
    const wave =
      Math.sin(2 * Math.PI * base * t) * 0.45 +
      Math.sin(2 * Math.PI * base * 1.5 * t) * 0.2 +
      Math.sin(2 * Math.PI * base * 2 * t) * 0.12;
    const gate = 0.72 + 0.28 * Math.sin(2 * Math.PI * pulse * t);
    data[i] = wave * gate * 0.18;
  }
  return buffer;
}

function makeSfxBuffer(ctx: AudioContext, track: Track, duration: number) {
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const base = track.frequency;
  for (let i = 0; i < length; i += 1) {
    const t = i / ctx.sampleRate;
    const p = i / Math.max(1, length - 1);
    const envelope = Math.pow(1 - p, 2);
    const sweep = base + base * 0.34 * (1 - p);
    data[i] = Math.sin(2 * Math.PI * sweep * t) * envelope * 0.42;
  }
  return buffer;
}

function pushAudioEvent(type: string, detail: Record<string, unknown>) {
  audioEvents.push({
    type,
    at: audioContext ? Number(audioContext.currentTime.toFixed(3)) : 0,
    ...detail,
  });
  if (audioEvents.length > 60) audioEvents.shift();
  if (document?.documentElement) {
    document.documentElement.dataset.audioEvents = encodeURIComponent(JSON.stringify(audioEvents.slice(-40)));
  }
}
