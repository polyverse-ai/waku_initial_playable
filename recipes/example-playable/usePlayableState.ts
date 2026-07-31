import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAudioDebugState,
  installDefaultAudioSet,
  playBgm,
  playSfx,
  stopBgm,
} from "./audio";
import { registerWakuPreviewStates, reportWakuPreviewState } from "../../src/waku/polyverse";

const TARGET_SCORE = 3;
type Phase = "ready" | "playing" | "result";
type Feedback = "off" | "on";

export interface PlayableEvent extends Record<string, unknown> {
  type: string;
  at: number;
}

export interface ResultState extends Record<string, unknown> {
  outcome: "complete" | "failed";
  reason: string;
  completedInSec: number;
  score: number;
}

export interface PlayableState {
  phase: Phase;
  score: number;
  target: number;
  gameStarted: boolean;
  bgmStarted: boolean;
  hasFirstInteraction: boolean;
  completedInSec: number;
  lastFeedbackMs: number;
  resultReason: string;
  feedback: Feedback;
  result: ResultState | null;
}

const initialPlayableState: PlayableState = {
  phase: "ready",
  score: 0,
  target: TARGET_SCORE,
  gameStarted: false,
  bgmStarted: false,
  hasFirstInteraction: false,
  completedInSec: 0,
  lastFeedbackMs: 0,
  resultReason: "",
  feedback: "off",
  result: null,
};

function now() {
  return Number(performance.now().toFixed(2));
}

function makeResult(reason: string, completedInSec: number, score: number): ResultState {
  return {
    outcome: reason === "forced-lose" ? "failed" : "complete",
    reason,
    completedInSec,
    score,
  };
}

export function usePlayableState() {
  const [state, setState] = useState<PlayableState>(initialPlayableState);
  const [events, setEvents] = useState<PlayableEvent[]>([]);
  const stateRef = useRef(state);
  const eventsRef = useRef(events);
  const roundStartedAtRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    eventsRef.current = events;
    window.__WAKU_TEMPLATE_EVENTS__ = events;
  }, [events]);

  const logEvent = useCallback((type: string, detail: Record<string, unknown> = {}) => {
    setEvents((previous) => {
      const next = [...previous, { type, at: now(), ...detail }];
      return next.length > 120 ? next.slice(next.length - 120) : next;
    });
  }, []);

  const snapshot = useCallback(() => {
    const s = stateRef.current;
    return {
      phase: s.phase,
      score: s.score,
      target: s.target,
      gameStarted: s.gameStarted,
      bgmStarted: s.bgmStarted,
      hasFirstInteraction: s.hasFirstInteraction,
      completedInSec: s.completedInSec,
      lastFeedbackMs: s.lastFeedbackMs,
      resultReason: s.resultReason,
    };
  }, []);

  const finishRound = useCallback(
    (reason: string, forcedScore?: number) => {
      const current = stateRef.current;
      if (current.phase === "result") return;
      const completedInSec = roundStartedAtRef.current
        ? Number(((performance.now() - roundStartedAtRef.current) / 1000).toFixed(1))
        : 0;
      const finalScore = forcedScore ?? current.score;
      const result = makeResult(reason, completedInSec, finalScore);

      setState((previous) => ({
        ...previous,
        phase: "result",
        score: finalScore,
        gameStarted: false,
        completedInSec,
        resultReason: reason,
        result,
      }));
      roundStartedAtRef.current = null;
      playBgm(reason === "forced-lose" ? "fail" : "result");
      playSfx(reason === "forced-lose" ? "timeout" : "complete");
      logEvent("phase-change", { phase: "result", score: finalScore });
      logEvent("result", { success: reason !== "forced-lose", reason, score: finalScore });
    },
    [logEvent],
  );

  const enterReady = useCallback(() => {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    stopBgm();
    roundStartedAtRef.current = null;
    setState(initialPlayableState);
    logEvent("phase-change", { phase: "ready", score: 0 });
  }, [logEvent]);

  const pulseFeedback = useCallback(() => {
    if (feedbackTimerRef.current != null) window.clearTimeout(feedbackTimerRef.current);
    setState((previous) => ({ ...previous, feedback: "on" }));
    feedbackTimerRef.current = window.setTimeout(() => {
      setState((previous) => ({ ...previous, feedback: "off" }));
      feedbackTimerRef.current = null;
    }, 120);
  }, []);

  const handlePrimaryPointer = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const feedbackStart = performance.now();
      const current = stateRef.current;

      if (current.phase === "result") {
        logEvent("ignored-input", { phase: current.phase, score: current.score });
        return;
      }

      const startsNow = current.phase === "ready";
      const shouldStartBgm = !current.bgmStarted;
      const beforeScore = current.score;
      const nextScore = Math.min(TARGET_SCORE, current.score + 1);
      const feedbackMs = Math.max(0, performance.now() - feedbackStart);

      if (startsNow) {
        roundStartedAtRef.current = performance.now();
        logEvent("phase-change", { phase: "playing", score: beforeScore });
        logEvent("first-interaction", { phase: "playing" });
      }

      setState((previous) => ({
        ...previous,
        phase: "playing",
        score: nextScore,
        gameStarted: true,
        bgmStarted: shouldStartBgm ? true : previous.bgmStarted,
        hasFirstInteraction: true,
        lastFeedbackMs: feedbackMs,
      }));

      pulseFeedback();
      logEvent("input-feedback", {
        feedbackMs: Number(feedbackMs.toFixed(2)),
        score: nextScore,
        beforeScore,
      });
      logEvent("score-change", { score: nextScore, target: TARGET_SCORE });

      if (shouldStartBgm) window.setTimeout(() => playBgm("loop"), 0);
      playSfx("tap");

      if (nextScore >= TARGET_SCORE) finishRound("complete", nextScore);
    },
    [finishRound, logEvent, pulseFeedback],
  );

  useEffect(() => {
    installDefaultAudioSet();
    logEvent("boot-visible", { coreObjectVisible: true, phase: "ready" });
    return () => {
      if (feedbackTimerRef.current != null) window.clearTimeout(feedbackTimerRef.current);
      stopBgm();
    };
  }, [logEvent]);

  // Preview mock: jump straight to mid-play (one hit from target), no real input.
  const applyMockPlaying = useCallback(() => {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    stopBgm();
    roundStartedAtRef.current = performance.now();
    setState({
      ...initialPlayableState,
      phase: "playing",
      score: TARGET_SCORE - 1,
      gameStarted: true,
      hasFirstInteraction: true,
    });
    logEvent("phase-change", { phase: "playing", score: TARGET_SCORE - 1, mock: true });
  }, [logEvent]);

  // Register the three preview states (ready/playing/result), each reachable by a
  // hardcoded mock; the host renders a state bar from them.
  useEffect(() => {
    void registerWakuPreviewStates([
      { id: "ready", title: "Start", page: "1", apply: enterReady },
      {
        id: "playing",
        title: "Playing",
        page: "2",
        mock: { score: TARGET_SCORE - 1, target: TARGET_SCORE },
        apply: applyMockPlaying,
      },
      {
        id: "result",
        title: "Result",
        page: "3",
        mock: { score: TARGET_SCORE, outcome: "complete" },
        apply: () => finishRound("preview-mock", TARGET_SCORE),
      },
    ]);
  }, [applyMockPlaying, enterReady, finishRound]);

  // Report phase (= registered state id) from one place, covering manual play and
  // goto/apply; the host highlights it on the track.
  useEffect(() => {
    void reportWakuPreviewState(state.phase);
  }, [state.phase]);

  useEffect(() => {
    const surface = {
      getState: snapshot,
      getAudioState: getAudioDebugState,
      getEvents: () => [...eventsRef.current],
      getCheckpoints: () =>
        eventsRef.current.filter((eventRecord) => eventRecord.type === "phase-change" || eventRecord.type === "result"),
      getAssets: () => [],
      getPerformanceStats: () => ({
        lastFeedbackMs: stateRef.current.lastFeedbackMs,
        events: eventsRef.current.length,
      }),
      getResult: () => (stateRef.current.result ? { ...stateRef.current.result } : null),
      reset: enterReady,
      forceWin: () => finishRound("forced-win", TARGET_SCORE),
      forceLose: () => finishRound("forced-lose", stateRef.current.score),
    };
    window.__WAKU_GAME__ = surface;
    window.__WAKU_TEMPLATE_DEBUG__ = surface;

    // Standard machine-verify hook (auto-smoke.mjs drives it to assert the state
    // machine advances). Wire it to your real core action — here a tap drives
    // ready -> playing -> result. Keep this contract; rename nothing.
    const tap = () =>
      handlePrimaryPointer({ preventDefault() {} } as unknown as React.PointerEvent<HTMLButtonElement>);
    window.__waku_debug = {
      getState: snapshot,
      start: tap,
      step: (n = 1) => {
        for (let i = 0; i < Math.max(1, n); i += 1) tap();
      },
    };
  }, [enterReady, finishRound, handlePrimaryPointer, snapshot]);

  const dataset = useMemo(
    () => ({
      "data-phase": state.phase,
      "data-score": String(state.score),
      "data-target": String(state.target),
      "data-game-started": String(state.gameStarted),
      "data-bgm-started": String(state.bgmStarted),
      "data-has-first-interaction": String(state.hasFirstInteraction),
      "data-completed-in-sec": String(state.completedInSec),
      "data-last-feedback-ms": state.lastFeedbackMs.toFixed(2),
      "data-feedback": state.feedback,
      "data-result": state.result?.outcome ?? "",
      "data-events": encodeURIComponent(JSON.stringify(events.slice(-50))),
    }),
    [events, state],
  );

  return {
    state,
    events,
    dataset,
    handlePrimaryPointer,
    reset: enterReady,
  };
}
