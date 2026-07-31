/**
 * score-combo-tracker — reusable scoring/combo/streak engine
 *
 * Zero game-logic coupling. Wire it to any event source (tap, match, hit…).
 * All randomness is injected; the module itself is deterministic.
 *
 * Usage:
 *   const tracker = createScoreComboTracker({ scorePerEvent: 100, leaderboardSize: 5 });
 *   tracker.recordEvent();           // normal hit
 *   tracker.recordEvent(0.5);        // weighted hit (e.g. from an AI quality score 0–1)
 *   tracker.breakCombo();            // explicit miss / gap
 *   tracker.subscribe(state => ...); // reactive updates
 *   tracker.saveToLeaderboard("Alice");
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface StreakThreshold {
  /** Minimum consecutive hits to activate this tier. */
  streak: number;
  /** Score multiplier active at this tier. */
  multiplier: number;
  /** Arbitrary string tag (e.g. "flame", "hyper", "normal"). */
  state: string;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  timestamp: number;
}

export interface TrackerState {
  score: number;
  combo: number;
  /** Active multiplier derived from combo + thresholds. */
  multiplier: number;
  /** Tag from the matching StreakThreshold (or "normal" when below all thresholds). */
  streakState: string;
  leaderboard: readonly LeaderboardEntry[];
}

export interface TrackerConfig {
  /** Base score added per event before multiplier. Default 100. */
  scorePerEvent?: number;
  /**
   * Override multiplier calculation. Receives current combo count,
   * returns the raw multiplier before threshold overrides.
   * Default: 1 + combo * 0.1 (capped at 4×).
   */
  comboMultiplier?: (combo: number) => number;
  /**
   * Ordered list of streak tiers (ascending by `streak`).
   * The highest matching tier wins.
   */
  streakThresholds?: StreakThreshold[];
  /** Called when combo drops to 0. Receives final combo length. */
  onComboBreak?: (finalCombo: number) => void;
  /**
   * Called when active streak tier changes.
   * Receives new state string and new multiplier.
   */
  onStreakChange?: (streakState: string, multiplier: number) => void;
  /** Maximum entries kept in local leaderboard. Default 10. */
  leaderboardSize?: number;
}

export type StateListener = (state: Readonly<TrackerState>) => void;

export interface ScoreComboTracker {
  /** Record a scoring event. `weight` (0–1) scales the base score additively (default 1). */
  recordEvent(weight?: number): void;
  /** Explicitly break the current combo (e.g. on miss or timeout). */
  breakCombo(): void;
  /** Reset score, combo and streak to initial values (leaderboard preserved). */
  reset(): void;
  /** Save current score to leaderboard under a player name. */
  saveToLeaderboard(name: string): void;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(listener: StateListener): () => void;
  /** Read current state without subscribing. */
  getState(): Readonly<TrackerState>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: StreakThreshold[] = [
  { streak: 5,  multiplier: 1.5, state: "warm"  },
  { streak: 10, multiplier: 2,   state: "hot"   },
  { streak: 20, multiplier: 3,   state: "flame" },
];

function defaultComboMultiplier(combo: number): number {
  return Math.min(1 + combo * 0.1, 4);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new score-combo-tracker instance.
 * Each call returns a fully independent tracker; safe to create multiple per game scene.
 */
export function createScoreComboTracker(config: TrackerConfig = {}): ScoreComboTracker {
  const {
    scorePerEvent    = 100,
    comboMultiplier  = defaultComboMultiplier,
    streakThresholds = DEFAULT_THRESHOLDS,
    onComboBreak,
    onStreakChange,
    leaderboardSize  = 10,
  } = config;

  // Sort thresholds ascending so we can pick the last matching one.
  const sortedThresholds = [...streakThresholds].sort((a, b) => a.streak - b.streak);

  let score       = 0;
  let combo       = 0;
  let multiplier  = 1;
  let streakState = "normal";
  let leaderboard: LeaderboardEntry[] = [];

  const listeners = new Set<StateListener>();

  // ── Internal helpers ────────────────────────────────────────────────────────

  function resolveStreak(currentCombo: number): { multiplier: number; state: string } {
    const base = comboMultiplier(currentCombo);
    let active: StreakThreshold | undefined;
    for (const t of sortedThresholds) {
      if (currentCombo >= t.streak) active = t;
    }
    return active
      ? { multiplier: active.multiplier, state: active.state }
      : { multiplier: base, state: "normal" };
  }

  function notify() {
    const snap = getState();
    for (const fn of listeners) fn(snap);
  }

  function applyStreak(newCombo: number) {
    const resolved = resolveStreak(newCombo);
    const prevState = streakState;
    multiplier  = resolved.multiplier;
    streakState = resolved.state;
    if (streakState !== prevState) {
      onStreakChange?.(streakState, multiplier);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function recordEvent(weight = 1): void {
    const clampedWeight = Math.max(0, Math.min(1, weight));
    combo += 1;
    applyStreak(combo);
    score += Math.round(scorePerEvent * clampedWeight * multiplier);
    notify();
  }

  function breakCombo(): void {
    if (combo === 0) return;
    const final = combo;
    combo       = 0;
    applyStreak(0);
    onComboBreak?.(final);
    notify();
  }

  function reset(): void {
    score       = 0;
    combo       = 0;
    multiplier  = 1;
    streakState = "normal";
    notify();
  }

  function saveToLeaderboard(name: string): void {
    const entry: LeaderboardEntry = { name, score, timestamp: Date.now() };
    leaderboard = [...leaderboard, entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, leaderboardSize);
    notify();
  }

  function subscribe(listener: StateListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState(): Readonly<TrackerState> {
    return {
      score,
      combo,
      multiplier,
      streakState,
      leaderboard: [...leaderboard],
    };
  }

  return { recordEvent, breakCombo, reset, saveToLeaderboard, subscribe, getState };
}
