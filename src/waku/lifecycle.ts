import { useEffect, useSyncExternalStore } from "react";
import { readyWakuRuntime } from "./polyverse";

// Host-driven content lifecycle (contract v0.2): the host controls
// start / pause / resume; reset is a host-side reload — content never resets
// itself. Boot semantics are "ready and silent": mount renders the static
// first frame and registers handlers; every running side effect (rAF loops,
// BGM, timers, sensors) must hang off start/resume.
//
// This module owns one lifecycle store per page and wires it to
// pv.lifecycle.install (the SDK normalizes the host channels — window events,
// iframe postMessage, __hostEvent — and answers the ready handshake).
// Consume the state via useWakuLifecycle() and gate your loops on
// state === "running".

export type WakuLifecycleState = "ready" | "running" | "paused";

export interface WakuLifecycleHooks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

interface WakuLifecycleClientLike {
  install?(options: {
    onStart: () => void;
    onPause?: () => void;
    onResume?: () => void;
    policy?: { resume: "continue" | "restart" };
  }): unknown;
}

let lifecycleState: WakuLifecycleState = "ready";
const stateListeners = new Set<() => void>();
let initStarted = false;

function setLifecycleState(next: WakuLifecycleState) {
  if (lifecycleState === next) return;
  lifecycleState = next;
  for (const listener of stateListeners) listener();
}

export function getWakuLifecycleState(): WakuLifecycleState {
  return lifecycleState;
}

export function subscribeWakuLifecycle(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

// A lifecycle-driving host exists when we run inside a native bridge webview,
// inside an iframe shell, or when ?waku-host=1 simulates one (used by
// auto-smoke to test the frozen ready state). A plain top-level browser tab
// (local dev) has no host to send start — we self-start there so the template
// stays debuggable by just opening it.
function lifecycleHostPresent(): boolean {
  const w = window as unknown as Record<string, unknown> & {
    webkit?: { messageHandlers?: { polyverse?: unknown } };
  };
  if (w.webkit?.messageHandlers?.polyverse || w._PolyverseAndroid) return true;
  try {
    if (window.parent && window.parent !== window) return true;
  } catch {
    return true; // cross-origin parent access throws — definitely framed
  }
  try {
    return new URLSearchParams(window.location.search).has("waku-host");
  } catch {
    return false;
  }
}

// Install the lifecycle contract once per page. Degrades gracefully: on an old
// host / stale SDK without pv.lifecycle the content behaves like before (runs
// on load), so the template never freezes dead on legacy embeddings.
export function initWakuLifecycle(hooks: WakuLifecycleHooks = {}) {
  if (initStarted) return;
  initStarted = true;
  void (async () => {
    let installed = false;
    try {
      const client = (await readyWakuRuntime()) as { lifecycle?: WakuLifecycleClientLike } | undefined;
      if (client?.lifecycle?.install) {
        client.lifecycle.install({
          onStart: () => {
            setLifecycleState("running");
            hooks.onStart?.();
          },
          // The template demo freezes losslessly (attract loop + suspended
          // AudioContext), so it honestly declares pause/resume. Content that
          // cannot freeze losslessly must NOT pass onPause/onResume — the SDK
          // then declares supports:['start'] and the host reloads on swipe-away.
          onPause: () => {
            setLifecycleState("paused");
            hooks.onPause?.();
          },
          onResume: () => {
            setLifecycleState("running");
            hooks.onResume?.();
          },
          policy: { resume: "continue" },
        });
        installed = true;
      }
    } catch {
      // fall through to the legacy path below
    }
    if (!installed) {
      // Legacy host / SDK without lifecycle: run on load, as content always did.
      setLifecycleState("running");
      hooks.onStart?.();
      return;
    }
    if (!lifecycleHostPresent()) {
      // Standalone browser tab: nobody will send start — self-start through the
      // real channel so the SDK state machine stays authoritative.
      window.dispatchEvent(new Event("polyverse:start"));
    }
  })();
}

// React binding: initializes the contract on mount (singleton, StrictMode-safe)
// and returns the live lifecycle state. Gate every loop on "running".
export function useWakuLifecycle(hooks: WakuLifecycleHooks = {}): WakuLifecycleState {
  useEffect(() => {
    initWakuLifecycle(hooks);
    // hooks are captured on first init only — the singleton ignores re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useSyncExternalStore(subscribeWakuLifecycle, getWakuLifecycleState, () => "ready");
}
