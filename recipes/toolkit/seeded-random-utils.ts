/**
 * seeded-random-utils — bucket: randomizer
 *
 * The un-weighted, zero-dependency "seeded randomness kernel" that playables rewrite over and over so that a
 * given seed (or share string, or calendar day) reproduces the exact same
 * draws. Pure TS — no DOM, no Date.now() in the generation path, never touches
 * Math.random unless you explicitly ask for an entropy seed.
 *
 * The primitives below are the byte-level common denominator observed across
 * many production playables:
 *  - mulberry32(seed): small fast 32-bit PRNG returning [0, 1).
 *  - hashString(str): FNV-1a → uint32, used to derive a numeric seed from a
 *    share code, content id, or a date key (the "daily/key-stable pick").
 *  - shuffle / pick / pickN / int / chance: the helper set that every content
 *    re-implements around the PRNG.
 *  - createSeededRandom(seed): convenience factory bundling them onto one
 *    stateful instance (seed may be a number or any string — strings are
 *    hashed). Mirrors the per-content `RNG` class / `makeRng` object.
 *
 * This module deliberately stays un-weighted — build weighted sampling,
 * no-repeat windows, or pity systems on top of these primitives.
 */

/** mulberry32 — small, fast, deterministic 32-bit PRNG. Returns a function yielding [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic FNV-1a hash of a string → uint32. Stable across runs/machines. */
export function hashString(str: string): number {
  let h = 0x811c9dc5 >>> 0; // FNV offset basis (== 2166136261)
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // FNV prime (== 16777619)
  }
  return h >>> 0;
}

/** Coerce a number|string seed into a uint32 seed (strings go through hashString). */
export function toSeed(seed: number | string): number {
  return (typeof seed === "number" ? seed : hashString(seed)) >>> 0;
}

/** Integer in [min, max] inclusive, drawn from an rng function. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** True with probability p ∈ [0, 1]. */
export function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}

/** Pick a single element from a non-empty array. */
export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Fisher–Yates shuffle. Returns a NEW array (input is not mutated) so it is safe
 * to call on shared/frozen data. Same rng sequence → same ordering.
 */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * Pick n distinct elements (no element chosen twice) via a partial Fisher–Yates.
 * n is clamped to the array length, so it never throws on n > arr.length.
 */
export function pickN<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const count = Math.max(0, Math.min(n | 0, arr.length));
  const a = arr.slice();
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(rng() * (a.length - i));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a.slice(0, count);
}

/** A stateful seeded randomizer instance (the return of createSeededRandom). */
export interface SeededRandom {
  /** Float in [0, 1). Advances the stream. */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p ∈ [0, 1]. */
  chance(p: number): boolean;
  /** Pick one element from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Shuffle a copy of the array (input untouched). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Pick n distinct elements (clamped to array length). */
  pickN<T>(arr: readonly T[], n: number): T[];
  /** Reset the stream back to the original (or a new) seed. */
  reseed(seed?: number | string): void;
  /** The uint32 seed currently driving the stream. */
  readonly seed: number;
}

/**
 * Build a stateful seeded randomizer. `seed` may be a number or any string
 * (strings are hashed via hashString — pass a content id, share code, or a
 * "YYYY-MM-DD" date key for a daily-stable pick). Omit `seed` to draw a
 * one-time entropy seed from Math.random (only place this module touches it).
 */
export function createSeededRandom(seed?: number | string): SeededRandom {
  let current = seed === undefined ? (Math.random() * 0x100000000) >>> 0 : toSeed(seed);
  let next = mulberry32(current);

  return {
    next: () => next(),
    int: (min, max) => randInt(next, min, max),
    chance: (p) => chance(next, p),
    pick: (arr) => pick(arr, next),
    shuffle: (arr) => shuffle(arr, next),
    pickN: (arr, n) => pickN(arr, n, next),
    reseed: (s) => {
      current = s === undefined ? current : toSeed(s);
      next = mulberry32(current);
    },
    get seed() {
      return current;
    },
  };
}
