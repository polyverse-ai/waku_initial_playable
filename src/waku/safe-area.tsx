import { type ReactNode } from "react";
import { type WakuLifecycleState } from "./lifecycle";

// Platform-owned safe-area / z-layer primitives. Content composes these instead
// of hand-writing the platform class names, so host-chrome geometry stays a
// platform concern. Stack order (index.css): .bg-layer(0) < .stage(1) < .safe-ui(2).

// Full-bleed, non-interactive backdrop (ambience / texture). May cross host chrome.
export function BgLayer() {
  return <div className="bg-layer" aria-hidden="true" />;
}

// Full-bleed interactive world layer for canvas / scene content. `active` mirrors
// the lifecycle so consumers (and CSS) can gate on data-lifecycle running/paused.
export function Stage({ active, children }: { active: boolean; children?: ReactNode }) {
  return (
    <div className="stage" data-lifecycle={active ? "running" : "paused"}>
      {children}
    </div>
  );
}

// Safe-area UI layer (avoids host top/bottom chrome). Holds readable/tappable UI.
export function SafeUI({ lifecycle, children }: { lifecycle: WakuLifecycleState; children?: ReactNode }) {
  return (
    <main className="safe-ui" data-lifecycle={lifecycle}>
      {children}
    </main>
  );
}
