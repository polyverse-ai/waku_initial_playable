/**
 * media-element-audio-with-synth-fallback — bucket: audio / infrastructure
 *
 * A drop-in browser audio manager for playable content: one looping BGM (singleton,
 * mutually exclusive) plus fire-and-forget SFX, with mute, ducking, and first-gesture
 * unlock — and the defining feature: it NEVER goes silent.
 *
 * SFX have three paths, tried in order. BGM has two (2 then 3): it is a singleton with
 * no per-shot cost, so it stays on the element path and is never decoded into memory.
 *
 *  1. DECODED BUFFER (preferred for SFX): fetch() + decodeAudioData() the asset ONCE,
 *     then each shot is a bare createBufferSource(). Web Audio overlaps natively, so this
 *     keeps the "overlapping SFX don't cut each other off" property without allocating
 *     anything per shot. This matters: a fresh HTMLAudioElement per shot spins up a
 *     media-pipeline instance, which on iOS is expensive OUTSIDE the JS thread and
 *     degrades the more it is used — at ~14 shots/s it drops a real device from 60fps
 *     to single digits (iPhone 15 Pro / iOS 18.7: element 35fps p95 90ms vs buffer
 *     55.6fps p95 21ms vs 60fps doing nothing).
 *  2. ELEMENT (fallback, and the only path for BGM): play the durable URL through an
 *     HTMLAudioElement. Kept because it is NOT gated by CORS, whereas fetch()+decode IS:
 *     durable asset buckets (e.g. GCS) commonly serve no Access-Control-Allow-Origin
 *     header, so tier 1 fails for cross-origin assets. Setting an <audio> element's src
 *     to a cross-origin URL is normal, credential-free media loading — not a fetch of
 *     the bytes. When the playable and its assets share an origin (the common GCS
 *     layout: both under storage.googleapis.com), tier 1 wins and this never runs.
 *  3. SYNTH fallback: if a track has no URL, fails to load, or play() rejects, the
 *     manager synthesizes audio programmatically with the Web Audio API (a parametric
 *     looping BGM and parametric one-shot SFX waveforms). So a missing or CORS-blocked
 *     asset degrades to a procedural tone instead of dead air.
 *
 * The host owns content: voices/timbres (the music-box score, the SFX waveform per
 * variant) are config defaults you can fully override. The component binds to no
 * specific game's assets — pass it a track table.
 *
 * First-gesture unlock: browsers block audio until a user gesture. play() naturally
 * succeeds when first called from a pointer/click handler; call unlockOnGesture() to
 * eagerly resume a suspended AudioContext (and prime the element path) from your first
 * interaction so later programmatic plays are unblocked.
 *
 * SECURITY: contains NO endpoint, token, provider key, bearer header, MCP call, or
 * platform SDK. It uses only browser-native HTMLAudioElement and the Web Audio API.
 * Track URLs are caller-supplied durable media URLs assigned to Audio.src — that is
 * ordinary media loading, not a network fetch of bytes and not a credentialed call.
 */

// ── public types ──────────────────────────────────────────────────────────────

/** Which path a track played through, reported to onEvent for debugging/telemetry. */
export type AudioPlaybackPath = "buffer" | "element" | "synth";

/** Built-in synthesized SFX waveform shapes (override via synthSfx in config). */
export type SfxVariant = "tick" | "thud" | "bell" | "whoosh" | "press" | "blip";

export interface TrackDef {
  /** "bgm" loops and is a singleton; "sfx" is a one-shot. */
  kind: "bgm" | "sfx";
  /**
   * Durable media URL played via HTMLAudioElement. Omit (or leave empty) to force the
   * synth path. Cross-origin URLs are fine — element playback isn't CORS-gated.
   */
  url?: string;
  /** Linear volume 0..1 applied to both element and synth paths. Default 1. */
  volume?: number;
  /** Base frequency (Hz) for the synth SFX fallback. Default 220. */
  freq?: number;
  /** Waveform shape for the synth SFX fallback. Default "blip". */
  variant?: SfxVariant;
  /** Duration (s) of the synth fallback buffer (BGM loop length / SFX tail). Default: bgm 12, sfx 0.5. */
  duration?: number;
}

export interface AudioManagerConfig {
  /** Track table: id -> definition. Can also be registered later via register(). */
  tracks?: Record<string, TrackDef>;
  /** Start muted. Default false. */
  muted?: boolean;
  /**
   * Synth BGM loop generator (the "voice"/score of the fallback music). Override to
   * change the fallback timbre without touching real assets. Default: 2-voice music box.
   */
  synthBgm?: (ctx: BaseAudioContext, track: ResolvedTrack) => AudioBuffer;
  /**
   * Synth SFX waveform generator. Override to change fallback SFX timbres. Default:
   * parametric waveforms keyed by track.variant.
   */
  synthSfx?: (ctx: BaseAudioContext, track: ResolvedTrack) => AudioBuffer;
  /** Optional observer for lifecycle events (start/fail/fallback), for debugging/tests. */
  onEvent?: (e: AudioEvent) => void;
}

export interface AudioEvent {
  type:
    | "bgm-start"
    | "bgm-stop"
    | "sfx"
    | "load-fail"
    | "play-fail"
    /** fetch()+decodeAudioData() failed (usually cross-origin) → SFX stays on the element path. */
    | "decode-fail"
    | "synth-fallback"
    | "muted";
  id?: string;
  path?: AudioPlaybackPath;
}

/** Options for a single playBgm call. */
export interface PlayBgmOpts {
  /** Override the registered volume for this play, 0..1. */
  volume?: number;
  /** Restart from 0 if this BGM is already the current one. Default true. */
  restart?: boolean;
}

/** A TrackDef with all defaults resolved — what synth generators receive. */
export interface ResolvedTrack {
  kind: "bgm" | "sfx";
  url: string;
  volume: number;
  freq: number;
  variant: SfxVariant;
  duration: number;
}

export interface AudioManager {
  /** Register or replace a track at runtime. */
  register: (id: string, track: TrackDef) => void;
  /** Start (or switch to) a BGM by id. Singleton: stops any current BGM first. */
  playBgm: (id: string, opts?: PlayBgmOpts) => void;
  /** Stop the current BGM (element + synth). */
  stopBgm: () => void;
  /** Duck the current BGM to volume*factor over ms (e.g. under a voiceover). factor 0..1. */
  duckBgm: (factor: number, ms?: number) => void;
  /**
   * Play a one-shot SFX by id. No-op while muted. Safe to call at high rates: after the
   * asset is decoded once, each shot is a single Web Audio buffer source.
   */
  playSfx: (id: string) => void;
  /** Mute/unmute everything (affects element + synth, current + future). */
  setMuted: (value: boolean) => void;
  isMuted: () => boolean;
  /**
   * Prime audio from a user gesture: resume a suspended AudioContext and start decoding
   * real SFX assets in the background so gameplay's first shots already take the cheap
   * buffer path. Safe to call repeatedly (e.g. once per first pointerdown). Returns a
   * promise that resolves when the context is running (or immediately if there's nothing
   * to unlock) — it never waits on a decode.
   */
  unlockOnGesture: () => Promise<void>;
  /** Snapshot of internal state for debugging/tests. */
  getDebugState: () => {
    currentBgmId: string | null;
    muted: boolean;
    registered: string[];
    failed: string[];
    /** SFX ids with a decoded buffer ready — these take the cheap path. */
    decoded: string[];
    /** SFX ids whose decode failed (usually cross-origin) — these stay on the element path. */
    decodeFailed: string[];
    events: AudioEvent[];
  };
  /** Stop everything and release the AudioContext. */
  dispose: () => void;
}

// ── factory ─────────────────────────────────────────────────────────────────────

export function createAudioManager(config: AudioManagerConfig = {}): AudioManager {
  const tracks = new Map<string, ResolvedTrack>();
  const baseEls = new Map<string, HTMLAudioElement>();
  const failed = new Set<string>();
  const log: AudioEvent[] = [];

  let muted = config.muted ?? false;
  let currentBgmId: string | null = null;
  let bgmEl: HTMLAudioElement | null = null;

  // Web Audio context, shared by the decoded-SFX path and the synth fallback.
  let audioCtx: AudioContext | null = null;
  let synthMaster: GainNode | null = null;
  let synthBgmSource: AudioBufferSourceNode | null = null;
  const synthCache = new Map<string, AudioBuffer>();

  // Decoded real SFX assets: id -> AudioBuffer. Own master gain, deliberately NOT
  // synthMaster: duckBgm() ramps that one, and ducking BGM must not duck SFX.
  let sfxMaster: GainNode | null = null;
  const sfxBuffers = new Map<string, AudioBuffer>();
  const decoding = new Set<string>();
  const decodeFailed = new Set<string>();

  const synthBgmFn = config.synthBgm ?? defaultMusicBoxLoop;
  const synthSfxFn = config.synthSfx ?? defaultSfx;

  function emit(type: AudioEvent["type"], id?: string, path?: AudioPlaybackPath) {
    const e: AudioEvent = { type, id, path };
    log.push(e);
    if (log.length > 60) log.shift();
    try {
      config.onEvent?.(e);
    } catch {
      // observer must never break playback
    }
  }

  function resolve(track: TrackDef): ResolvedTrack {
    const isBgm = track.kind === "bgm";
    return {
      kind: track.kind,
      url: track.url ?? "",
      volume: track.volume ?? 1,
      freq: track.freq ?? 220,
      variant: track.variant ?? "blip",
      duration: track.duration ?? (isBgm ? 12 : 0.5),
    };
  }

  function register(id: string, track: TrackDef) {
    const resolved = resolve(track);
    tracks.set(id, resolved);
    failed.delete(id);
    baseEls.delete(id);
    // drop any decode state from a previous track under this id
    sfxBuffers.delete(id);
    decoding.delete(id);
    decodeFailed.delete(id);
    if (!resolved.url) {
      // No real track → element path unavailable; will always synth.
      failed.add(id);
      return;
    }
    try {
      // Audio.src = url is media loading, NOT a CORS-gated fetch of bytes.
      const el = new Audio(resolved.url);
      el.preload = "auto";
      el.addEventListener("error", () => {
        failed.add(id);
        emit("load-fail", id);
      });
      baseEls.set(id, el);
    } catch {
      failed.add(id);
    }
  }

  function setMuted(value: boolean) {
    muted = value;
    if (bgmEl) bgmEl.muted = value;
    if (audioCtx) {
      synthMaster?.gain.setValueAtTime(value ? 0 : 1, audioCtx.currentTime);
      sfxMaster?.gain.setValueAtTime(value ? 0 : 1, audioCtx.currentTime);
    }
    emit("muted");
  }

  function playBgm(id: string, opts: PlayBgmOpts = {}) {
    const track = tracks.get(id);
    if (!track || track.kind !== "bgm") return;
    const restart = opts.restart ?? true;
    if (currentBgmId === id && bgmEl && !restart) return;
    stopBgm();
    currentBgmId = id;
    const vol = clamp01(opts.volume ?? track.volume);
    const el = baseEls.get(id);
    if (el && !failed.has(id)) {
      el.loop = true;
      el.muted = muted;
      el.volume = vol;
      try {
        el.currentTime = 0;
      } catch {
        // some engines throw before metadata loads; harmless
      }
      bgmEl = el;
      void el.play().then(
        () => emit("bgm-start", id, "element"),
        () => {
          failed.add(id);
          emit("play-fail", id);
          playSynthBgm(track, vol);
        },
      );
    } else {
      playSynthBgm(track, vol);
    }
  }

  function stopBgm() {
    if (bgmEl) {
      try {
        bgmEl.pause();
      } catch {
        // ignore
      }
      bgmEl = null;
    }
    stopSynthBgm();
    if (currentBgmId !== null) emit("bgm-stop", currentBgmId);
    currentBgmId = null;
  }

  function duckBgm(factor: number, ms = 200) {
    const id = currentBgmId;
    if (!id) return;
    const track = tracks.get(id);
    if (!track) return;
    const f = clamp01(factor);
    if (bgmEl) bgmEl.volume = clamp01(track.volume * f);
    if (synthMaster && audioCtx) {
      const target = muted ? 0 : f;
      synthMaster.gain.linearRampToValueAtTime(target, audioCtx.currentTime + ms / 1000);
    }
  }

  /**
   * Decode a real SFX asset into an AudioBuffer once, so later shots cost one
   * createBufferSource() instead of a whole HTMLAudioElement + media pipeline.
   * Cross-origin assets without ACAO fail here by design (fetch is CORS-gated where
   * element playback is not); that just leaves the element path in charge.
   */
  function primeSfxBuffer(id: string, track: ResolvedTrack) {
    if (track.kind !== "sfx" || !track.url) return;
    if (sfxBuffers.has(id) || decoding.has(id) || decodeFailed.has(id)) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    decoding.add(id);
    void (async () => {
      try {
        const resp = await fetch(track.url);
        if (!resp.ok) throw new Error(`status ${resp.status}`);
        const bytes = await resp.arrayBuffer();
        sfxBuffers.set(id, await ctx.decodeAudioData(bytes));
      } catch {
        decodeFailed.add(id);
        emit("decode-fail", id);
      } finally {
        decoding.delete(id);
      }
    })();
  }

  function playSfx(id: string) {
    const track = tracks.get(id);
    if (!track || track.kind !== "sfx") return;
    if (muted) return;

    // 1. decoded buffer: one cheap node per shot, overlaps natively. Requires a running
    //    context — while suspended a buffer source would play silently, so we fall through
    //    to the element path instead (it can still be unblocked by the calling gesture).
    const buffer = sfxBuffers.get(id);
    if (buffer && audioCtx && sfxMaster && audioCtx.state === "running") {
      const source = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(clamp01(track.volume), audioCtx.currentTime);
      source.connect(gain).connect(sfxMaster);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(audioCtx.currentTime);
      emit("sfx", id, "buffer");
      return;
    }

    // Not decoded yet (or decode is unavailable) — start it for next time; this shot
    // still goes out below, so the first shots are never dropped or delayed.
    primeSfxBuffer(id, track);

    // 2. element path: CORS-safe, works where decode can't.
    if (!failed.has(id)) {
      const def = baseEls.get(id);
      try {
        // Fresh element per shot so overlapping SFX don't cut each other off.
        const el = def ? (def.cloneNode() as HTMLAudioElement) : new Audio(track.url);
        el.volume = clamp01(track.volume);
        void el.play().then(
          () => emit("sfx", id, "element"),
          () => {
            failed.add(id);
            emit("play-fail", id);
            playSynthSfx(track);
          },
        );
        return;
      } catch {
        failed.add(id);
      }
    }

    // 3. synth.
    playSynthSfx(track);
  }

  function unlockOnGesture(): Promise<void> {
    const ctx = ensureCtx();
    const resumed =
      ctx && ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve();
    return resumed.then(() => {
      // Prime real SFX assets from the gesture so gameplay's first shots already take
      // the buffer path. Fire-and-forget: never block the caller on a decode.
      for (const [id, track] of tracks) primeSfxBuffer(id, track);
    });
  }

  function dispose() {
    stopBgm();
    baseEls.clear();
    synthCache.clear();
    sfxBuffers.clear();
    decoding.clear();
    decodeFailed.clear();
    if (audioCtx) {
      try {
        void audioCtx.close();
      } catch {
        // ignore
      }
    }
    audioCtx = null;
    synthMaster = null;
    sfxMaster = null;
  }

  // ── synth fallback ────────────────────────────────────────────────────────────

  function ensureCtx(): AudioContext | null {
    const Ctor =
      globalThis.AudioContext ||
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) {
      audioCtx = new Ctor();
      synthMaster = audioCtx.createGain();
      synthMaster.gain.value = muted ? 0 : 1;
      synthMaster.connect(audioCtx.destination);
      sfxMaster = audioCtx.createGain();
      sfxMaster.gain.value = muted ? 0 : 1;
      sfxMaster.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function bufferFor(track: ResolvedTrack): AudioBuffer | null {
    const ctx = ensureCtx();
    if (!ctx) return null;
    const key = `${track.kind}:${track.variant}:${track.freq}:${track.duration}`;
    const cached = synthCache.get(key);
    if (cached) return cached;
    const buf = track.kind === "bgm" ? synthBgmFn(ctx, track) : synthSfxFn(ctx, track);
    synthCache.set(key, buf);
    return buf;
  }

  function playSynthBgm(track: ResolvedTrack, vol: number) {
    const ctx = ensureCtx();
    if (!ctx || !synthMaster) return;
    stopSynthBgm();
    const buffer = bufferFor(track);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(clamp01(vol), ctx.currentTime);
    source.connect(gain).connect(synthMaster);
    source.start(ctx.currentTime);
    synthBgmSource = source;
    emit("synth-fallback", currentBgmId ?? undefined, "synth");
  }

  function stopSynthBgm() {
    if (synthBgmSource) {
      try {
        synthBgmSource.stop();
      } catch {
        // ignore
      }
      synthBgmSource = null;
    }
  }

  function playSynthSfx(track: ResolvedTrack) {
    const ctx = ensureCtx();
    if (!ctx || !synthMaster) return;
    const buffer = bufferFor(track);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(clamp01(track.volume), ctx.currentTime);
    source.connect(gain).connect(synthMaster);
    source.start(ctx.currentTime);
    emit("synth-fallback", undefined, "synth");
  }

  // register initial tracks
  for (const [id, def] of Object.entries(config.tracks ?? {})) register(id, def);

  return {
    register,
    playBgm,
    stopBgm,
    duckBgm,
    playSfx,
    setMuted,
    isMuted: () => muted,
    unlockOnGesture,
    getDebugState: () => ({
      currentBgmId,
      muted,
      registered: [...tracks.keys()],
      failed: [...failed],
      decoded: [...sfxBuffers.keys()],
      decodeFailed: [...decodeFailed],
      events: log.slice(-30),
    }),
    dispose,
  };
}

// ── default synth voices (overridable via config) ─────────────────────────────────

/** 2-voice music-box loop: a short arpeggio bell over a soft fifth pad. */
export function defaultMusicBoxLoop(ctx: BaseAudioContext, track: ResolvedTrack): AudioBuffer {
  const dur = track.duration;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const scale = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
  const padRoot = 130.81;
  const noteLen = dur / scale.length;
  for (let i = 0; i < len; i += 1) {
    const t = i / ctx.sampleRate;
    const idx = Math.floor(t / noteLen) % scale.length;
    const local = t - Math.floor(t / noteLen) * noteLen;
    const f = scale[idx];
    const env = Math.exp(-local * 4.5);
    const bell = (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2 * t)) * env * 0.16;
    const pad = (Math.sin(2 * Math.PI * padRoot * t) + Math.sin(2 * Math.PI * padRoot * 1.5 * t)) * 0.04;
    data[i] = bell + pad;
  }
  return buf;
}

/** Parametric one-shot SFX keyed by track.variant. */
export function defaultSfx(ctx: BaseAudioContext, track: ResolvedTrack): AudioBuffer {
  const dur = track.duration;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const base = track.freq;
  for (let i = 0; i < len; i += 1) {
    const t = i / ctx.sampleRate;
    const p = i / Math.max(1, len - 1);
    let s = 0;
    if (track.variant === "tick") s = Math.sin(2 * Math.PI * base * t) * Math.exp(-p * 40);
    else if (track.variant === "bell")
      s = (Math.sin(2 * Math.PI * base * t) + 0.5 * Math.sin(2 * Math.PI * base * 2 * t)) * Math.exp(-p * 6);
    else if (track.variant === "thud") s = Math.sin(2 * Math.PI * (base - base * 0.5 * p) * t) * Math.exp(-p * 9);
    else if (track.variant === "whoosh") s = (Math.random() * 2 - 1) * Math.exp(-p * 6) * (1 - p) * 0.8;
    else if (track.variant === "press")
      s = Math.sin(2 * Math.PI * base * t) * (Math.sin(2 * Math.PI * 5 * t) > 0 ? 1 : 0.3) * 0.5;
    else s = Math.sin(2 * Math.PI * base * t) * Math.exp(-p * 3); // "blip"
    data[i] = s * 0.5;
  }
  return buf;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
