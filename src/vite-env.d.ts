/// <reference types="vite/client" />

interface PolyverseRuntime {
  ready(): Promise<unknown>;
}

declare global {
  interface Window {
    Polyverse?: PolyverseRuntime;
    __WAKU_TEMPLATE_EVENTS__?: Array<Record<string, unknown>>;
    // Standard machine-verify hook — scripts/auto-smoke.mjs drives this to
    // assert the state machine actually advances (objective "not stuck" check).
    // Expose it in every playable.
    __waku_debug?: WakuDebugHook;
    webkitAudioContext?: typeof AudioContext;
  }

  interface HTMLElementEventMap {
    "waku-replay": CustomEvent<void>;
  }
}

export interface WakuDebugHook {
  /** Serialisable snapshot of the current phase/state. */
  getState(): unknown;
  /** Leave attract/ready and enter the core loop (≈ the first real interaction). */
  start?(): void;
  /** Advance the core loop / simulate progress n times. */
  step?(n?: number): void;
}

export {};
