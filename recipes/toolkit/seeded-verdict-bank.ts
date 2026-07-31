/**
 * seeded-verdict-bank — bucket: ai-content
 *
 * The deterministic-fallback content layer that quiz/theater playables hand-wrote
 * over and over once the LLM was unreachable: a keyed, multilingual content bank
 * (per archetype / per axis / per band-tier), a seeded pick among each entry's
 * variants, slot-fill of the player's own concrete values into the chosen template,
 * and assembly of several keyed segments into one still-personalized verdict.
 *
 * Observed verbatim across 9 runs (quiz-fate oracle/doors/palm + theater confession):
 *  - FLAVOR / DRIVING_FORCE / FINEST_HOUR / CAREER_LINES[lang][tier] / THEMES — all
 *    `Record<key, variants>` banks of bilingual lines selected by a state-derived key.
 *  - same word-grab order / same axis tier → same fallback line, forever (seeded).
 *  - lines woven with the player's first/last grabbed word, dominant drive, echoed
 *    confession fragment via `${...}` / `{echo}` template slots.
 *
 * Division of labor: llm-structured-fallback-engine owns the LLM race + tolerant
 * parse + validate + the `fallback(input, seed)` HOOK; THIS module is what you put
 * INSIDE that hook — the bank structure, the seeded variant pick, and the slot-fill.
 * They compose; neither imports the other.
 *
 * Title/axes/tiers/languages/template text are ALL caller-supplied (theme-specific).
 * Pure TS — no DOM, no Date.now / Math.random in the selection path, no endpoint,
 * token, provider key, or platform SDK. Same seed → same verdict.
 */

// ── tiny inlined deterministic kernel (kept zero-dependency) ──────────────────
// Byte-identical to seeded-random-utils' mulberry32 / hashString; inlined so this
// module stays dependency-free. If you already depend on seeded-random-utils, pass
// its rng/seed in via `seedOf` / a precomputed seed and ignore these.

/** FNV-1a 32-bit string hash → uint32. Stable across runs/platforms. */
export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. Returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed a fresh PRNG from a string or number. */
export function seedRng(seed: string | number): () => number {
  return mulberry32(typeof seed === "number" ? seed >>> 0 : hashString(seed));
}

/** Pick one element using a [0,1) draw. Returns undefined only on an empty array. */
export function pickVariant<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

// ── content-bank types (caller supplies the data; module is theme-agnostic) ───

/**
 * One bank entry. Either:
 *  - a flat list of variants `V[]` (single language, or already-localized), or
 *  - a per-language map `Record<Lang, V[]>` of variants.
 * A variant V is whatever the composer consumes — usually a template string, but
 * may be a structured object (multi-field line); see `compose`.
 */
export type BankEntry<V, Lang extends string = string> = readonly V[] | Record<Lang, readonly V[]>;

/** A keyed content bank: archetype / axis / band-tier → variants. */
export type ContentBank<K extends string, V, Lang extends string = string> = Record<K, BankEntry<V, Lang>>;

/** Slot values woven into a chosen template (player's concrete features). */
export type Slots = Record<string, string | number>;

function isLangMap<V, Lang extends string>(
  entry: BankEntry<V, Lang>,
): entry is Record<Lang, readonly V[]> {
  return !Array.isArray(entry);
}

/** Resolve a bank entry to its variant list for `lang` (lang ignored for flat lists). */
export function variantsFor<V, Lang extends string>(
  entry: BankEntry<V, Lang>,
  lang?: Lang,
): readonly V[] {
  if (isLangMap(entry)) {
    if (lang === undefined) {
      // No lang given but entry is a map: take the first declared language.
      const first = Object.keys(entry)[0] as Lang | undefined;
      return first === undefined ? [] : entry[first];
    }
    return entry[lang] ?? [];
  }
  return entry;
}

// ── slot-fill ─────────────────────────────────────────────────────────────────

/**
 * Replace `${name}` and `{name}` slots in a template with values from `slots`.
 * Unmatched slots are left intact by default (set `stripUnmatched` to blank them).
 * Mirrors the hand-written `\`...${c.first}...\`` / `{echo}` weaving.
 */
export function slotFill(template: string, slots: Slots, stripUnmatched = false): string {
  return template.replace(/\$\{(\w+)\}|\{(\w+)\}/g, (whole, a: string, b: string) => {
    const key = a ?? b;
    const v = slots[key];
    if (v === undefined || v === null) return stripUnmatched ? "" : whole;
    return String(v);
  });
}

// ── seeded select + fill (the core primitive) ─────────────────────────────────

/**
 * Deterministically pick a variant from `bank[key]` for `lang` using `seed`, then,
 * if the variant is a string, slot-fill it with `slots`. Non-string variants are
 * returned as-is (compose them yourself). Order of (key, seed) → stable forever.
 *
 * `rnd` may be shared across several selectVerdict calls (as the hand-written code
 * did — one `seedRng(seed)` threaded through every line) so segments don't collide.
 */
export function selectVerdict<K extends string, V, Lang extends string>(
  bank: ContentBank<K, V, Lang>,
  key: K,
  opts: { lang?: Lang; slots?: Slots; rnd?: () => number; seed?: string | number; stripUnmatched?: boolean } = {},
): V | string | undefined {
  const entry = bank[key];
  if (entry === undefined) return undefined;
  const variants = variantsFor(entry, opts.lang);
  if (variants.length === 0) return undefined;
  const rnd = opts.rnd ?? seedRng(opts.seed ?? 0);
  const chosen = pickVariant(variants, rnd);
  if (typeof chosen === "string") {
    return opts.slots ? slotFill(chosen, opts.slots, opts.stripUnmatched) : chosen;
  }
  return chosen;
}

// ── multi-segment assembly ────────────────────────────────────────────────────

/** One segment of a multi-part verdict: which bank, which key, which slots. */
export interface SegmentSpec<K extends string, V, Lang extends string = string> {
  /** Stable name for the produced text (becomes a key in the result map). */
  name: string;
  bank: ContentBank<K, V, Lang>;
  /** State-derived key into the bank (archetype / axis tier / theme). */
  key: K;
  /** Per-segment slot overrides merged over the shared slots. */
  slots?: Slots;
}

export interface ComposeOptions<Lang extends string = string> {
  lang?: Lang;
  /** Slots shared by every segment (player's global features). */
  slots?: Slots;
  /** Seed for the whole verdict; one rng is threaded through all segments. */
  seed: string | number;
  stripUnmatched?: boolean;
}

/**
 * Assemble several keyed segments into one verdict, threading a single seeded rng
 * through them (deterministic, order-stable). Returns a `{ [segment.name]: text }`
 * map plus the seed used. Each segment's variant must be a string (the common
 * case); for structured variants, call `selectVerdict` per field instead.
 *
 * Subsumes oracle{title,bio}, fate{drivingForce,finestHour,softSpot,fateLine},
 * reading{career,love,money,reminder}, confession{probe,absolution,card}.
 */
export function composeVerdict<Lang extends string = string>(
  segments: readonly SegmentSpec<string, string, Lang>[],
  opts: ComposeOptions<Lang>,
): { fields: Record<string, string>; seed: number } {
  const seed = (typeof opts.seed === "number" ? opts.seed >>> 0 : hashString(opts.seed)) >>> 0;
  const rnd = mulberry32(seed);
  const fields: Record<string, string> = {};
  for (const seg of segments) {
    const slots = seg.slots ? { ...opts.slots, ...seg.slots } : opts.slots;
    const out = selectVerdict(seg.bank, seg.key, {
      lang: opts.lang,
      slots,
      rnd,
      stripUnmatched: opts.stripUnmatched,
    });
    fields[seg.name] = typeof out === "string" ? out : "";
  }
  return { fields, seed };
}
