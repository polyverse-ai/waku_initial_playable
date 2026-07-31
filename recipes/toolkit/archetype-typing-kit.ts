/**
 * archetype-typing-kit
 *
 * Psychometric *typing* primitives reached for again and again across
 * "quiz & fate" playables: turn a multi-axis vector / an ordered pick list
 * into a *named* archetype. Four pure functions, each abstracting one
 * hand-rolled pattern:
 *
 *   - nearestPrototype     — axis vector → closest named prototype (euclid/cosine)
 *   - signOrthant          — n axis signs → one of 2^n family keys (always hits)
 *   - argmaxWithShadow      — score map → primary (argmax) + shadow (runner-up)
 *   - pickHighlightWeakness — ordered picks → earliest lean / latest avoid
 *
 * Division of labour:
 *   - weighted-score-aggregator owns *per-axis* judging — accumulate deltas
 *     then look up a band / threshold range for each axis independently.
 *   - dialogue-ending-resolver owns *predicate priority* — argmax tag-tally +
 *     allOf/anyOf/not + cross-axis compares cascaded into a first-match ending.
 *   - this kit owns *psychometric typing* the other two can't express:
 *     prototype distance, sign-cube families, argmax-with-runner-up shadow,
 *     and ordered-sequence highlight/weakness extraction.
 *
 * Names, labels and copy stay with the caller — these return keys/ids only.
 * Pure TS, zero dependencies, no DOM, no I/O.
 */

// ── Shared ──────────────────────────────────────────────────────────────────

/** Axis vector: axis id → numeric value. */
export type AxisVector = Record<string, number>;

// ── 1. nearestPrototype ──────────────────────────────────────────────────────

/** A named reference point in axis space. */
export interface Prototype<K extends string = string> {
  /** Key returned when this prototype is closest. */
  key: K;
  /** Reference position; axes absent here are treated as 0. */
  vector: AxisVector;
}

export interface NearestPrototypeOptions {
  /**
   * Distance metric.
   *   "euclid" — squared Euclidean (default); smaller = closer.
   *   "cosine" — 1 − cosine similarity; orientation-only, ignores magnitude.
   */
  metric?: "euclid" | "cosine";
  /**
   * Axes to consider. Default: union of all axes seen in input + prototypes.
   * Pin this when input may carry stray axes you don't want scored.
   */
  axes?: string[];
}

export interface NearestPrototypeResult<K extends string = string> {
  /** Closest prototype's key. */
  key: K;
  /** Its distance under the chosen metric (squared for euclid). */
  distance: number;
  /** Index of the winning prototype in the input array. */
  index: number;
}

/**
 * Closest prototype to an axis vector. Ties resolve to the first prototype.
 * Throws if `prototypes` is empty.
 */
export function nearestPrototype<K extends string = string>(
  vec: AxisVector,
  prototypes: Prototype<K>[],
  opts: NearestPrototypeOptions = {},
): NearestPrototypeResult<K> {
  if (prototypes.length === 0) {
    throw new Error("nearestPrototype: prototypes must be non-empty");
  }
  const metric = opts.metric ?? "euclid";
  const axes = opts.axes ?? unionAxes([vec, ...prototypes.map((p) => p.vector)]);

  let bestKey = prototypes[0].key;
  let bestIdx = 0;
  let bestD = Infinity;

  for (let i = 0; i < prototypes.length; i++) {
    const d =
      metric === "cosine"
        ? cosineDistance(vec, prototypes[i].vector, axes)
        : squaredEuclid(vec, prototypes[i].vector, axes);
    if (d < bestD) {
      bestD = d;
      bestKey = prototypes[i].key;
      bestIdx = i;
    }
  }
  return { key: bestKey, distance: bestD, index: bestIdx };
}

// ── 2. signOrthant ───────────────────────────────────────────────────────────

export interface SignOrthantOptions {
  /**
   * Per-axis pole labels, in evaluation order. Each entry gives the symbol
   * used for the non-negative side and the negative side; the result key is
   * those symbols concatenated. Axes absent from `axes` default to value 0.
   *
   *   labels: [{ axis: "flavor", pos: "S", neg: "B" }, ...] -> "S" + ...
   */
  labels: Array<{ axis: string; pos: string; neg: string }>;
  /**
   * Which side a value of exactly 0 falls on.
   * "pos" (default) → 0 counts as the positive pole; "neg" → negative pole.
   */
  zero?: "pos" | "neg";
  /** Joiner between pole symbols. Default: "" (e.g. "SHO"). */
  separator?: string;
}

export interface SignOrthantResult {
  /** Concatenated family key, e.g. "SHO" — always one of 2^n, always hits. */
  key: string;
  /** Per-axis chosen pole symbol, in label order. */
  poles: string[];
}

/**
 * Map an axis vector to one of 2^n sign-orthant family keys. Guaranteed to
 * produce a key (the caller's archetype table should cover all 2^n, or supply
 * its own fallback when looking the key up).
 */
export function signOrthant(axes: AxisVector, opts: SignOrthantOptions): SignOrthantResult {
  const zeroPos = (opts.zero ?? "pos") === "pos";
  const sep = opts.separator ?? "";
  const poles = opts.labels.map(({ axis, pos, neg }) => {
    const v = axes[axis] ?? 0;
    const isPos = zeroPos ? v >= 0 : v > 0;
    return isPos ? pos : neg;
  });
  return { key: poles.join(sep), poles };
}

// ── 3. argmaxWithShadow ──────────────────────────────────────────────────────

export interface ArgmaxShadowOptions {
  /**
   * Tie-break when two scores are equal.
   *   "order"   — earlier key in `order` (or in scores insertion order) wins (default).
   *   "first"   — alias for "order".
   * Provide `order` to control the ranking explicitly.
   */
  tiebreak?: "order" | "first";
  /**
   * Explicit key ordering for ties / determinism. Defaults to the order of
   * keys in `scores`. Keys not listed sort after listed ones.
   */
  order?: string[];
  /**
   * Result when `scores` is empty or all keys are filtered out.
   * Returned as `primary` with `shadow: null` (the "hidden type" case).
   */
  hidden?: string;
  /** Numeric tolerance for treating two scores as tied. Default: 1e-9. */
  epsilon?: number;
}

export interface ArgmaxShadowResult {
  /** Highest-scoring key (the dominant / main type). */
  primary: string;
  /** Runner-up key (the shadow / secondary type); null when <2 candidates. */
  shadow: string | null;
  /** Full ranking, best first. */
  ranked: string[];
  /** True when input was empty and `hidden` was used. */
  isHidden: boolean;
}

/**
 * Rank a score map; return argmax as `primary` and the runner-up as `shadow`.
 * Empty input → `hidden` (or "" ) as primary with shadow null, isHidden true.
 */
export function argmaxWithShadow(
  scores: Record<string, number>,
  opts: ArgmaxShadowOptions = {},
): ArgmaxShadowResult {
  const eps = opts.epsilon ?? 1e-9;
  const keys = Object.keys(scores);
  const orderIndex = buildOrderIndex(opts.order ?? keys);

  if (keys.length === 0) {
    return { primary: opts.hidden ?? "", shadow: null, ranked: [], isHidden: true };
  }

  const ranked = [...keys].sort((a, b) => {
    const d = (scores[b] ?? 0) - (scores[a] ?? 0);
    if (Math.abs(d) > eps) return d > 0 ? 1 : -1;
    return rank(orderIndex, a) - rank(orderIndex, b);
  });

  return {
    primary: ranked[0],
    shadow: ranked.length > 1 ? ranked[1] : null,
    ranked,
    isHidden: false,
  };
}

// ── 4. pickHighlightWeakness ─────────────────────────────────────────────────

/** One ordered pick: a category plus an optional valence. */
export interface OrderedPick<C extends string = string> {
  /** Category / drive / element this pick leans toward. */
  category: C;
  /**
   * Optional valence flagging the pick as an embrace vs an avoidance.
   * When set, `lean` picks feed the highlight and `avoid` picks the weakness.
   */
  valence?: "lean" | "avoid";
}

export interface HighlightWeaknessOptions<C extends string = string> {
  /** Valence marking an embraced pick. Default: "lean". */
  leanValence?: string;
  /** Valence marking an avoided pick. Default: "avoid". */
  avoidValence?: string;
  /**
   * Fallback category when no lean/avoid pick exists.
   * highlight falls back to the first pick; weakness to the last pick;
   * both fall back to this when the list is empty.
   */
  fallback?: C;
}

export interface HighlightWeaknessResult<C extends string = string> {
  /** Earliest "lean" category; else the first pick; else fallback. */
  highlight: C;
  /** Latest "avoid" category; else the last pick; else fallback. */
  weakness: C;
}

/**
 * Extract a highlight (earliest embraced tendency) and a weakness (latest
 * avoided one) from an ordered pick sequence. Valence-tagged picks drive both;
 * absent valence falls back to sequence position (first = highlight,
 * last = weakness).
 */
export function pickHighlightWeakness<C extends string = string>(
  orderedPicks: OrderedPick<C>[],
  opts: HighlightWeaknessOptions<C> = {},
): HighlightWeaknessResult<C> {
  const leanV = opts.leanValence ?? "lean";
  const avoidV = opts.avoidValence ?? "avoid";
  const fallback = opts.fallback;

  const first = orderedPicks[0]?.category;
  const last = orderedPicks[orderedPicks.length - 1]?.category;

  const leanPick = orderedPicks.find((p) => p.valence === leanV);
  let avoidPick: OrderedPick<C> | undefined;
  for (let i = orderedPicks.length - 1; i >= 0; i--) {
    if (orderedPicks[i].valence === avoidV) {
      avoidPick = orderedPicks[i];
      break;
    }
  }

  const highlight = leanPick?.category ?? first ?? fallback;
  const weakness = avoidPick?.category ?? last ?? fallback;

  if (highlight === undefined || weakness === undefined) {
    throw new Error("pickHighlightWeakness: empty picks and no fallback supplied");
  }
  return { highlight, weakness };
}

// ── internals ────────────────────────────────────────────────────────────────

function unionAxes(vectors: AxisVector[]): string[] {
  const set = new Set<string>();
  for (const v of vectors) for (const k of Object.keys(v)) set.add(k);
  return [...set];
}

function squaredEuclid(a: AxisVector, b: AxisVector, axes: string[]): number {
  let sum = 0;
  for (const ax of axes) {
    const d = (a[ax] ?? 0) - (b[ax] ?? 0);
    sum += d * d;
  }
  return sum;
}

function cosineDistance(a: AxisVector, b: AxisVector, axes: string[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const ax of axes) {
    const x = a[ax] ?? 0;
    const y = b[ax] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 1; // undefined orientation → maximally far
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function buildOrderIndex(order: string[]): Map<string, number> {
  const m = new Map<string, number>();
  order.forEach((k, i) => {
    if (!m.has(k)) m.set(k, i);
  });
  return m;
}

function rank(index: Map<string, number>, key: string): number {
  return index.has(key) ? (index.get(key) as number) : Number.MAX_SAFE_INTEGER;
}
