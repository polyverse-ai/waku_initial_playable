import {
  useWakuLifecycle,
  BgLayer,
  Stage,
  SafeUI,
  suspendWakuAudio,
  resumeWakuAudio,
} from "./waku";
import { Content } from "./content/Content";

export function App() {
  // Host-driven lifecycle (contract v0.2): boot lands in "ready" (static first
  // frame, zero running side effects); the host sends start when the content is
  // shown, pause on swipe-away, resume on return. Audio freezes/thaws with it.
  const lifecycle = useWakuLifecycle({
    onPause: suspendWakuAudio,
    onResume: resumeWakuAudio,
  });
  const running = lifecycle === "running";

  return (
    <>
      <BgLayer />
      <Stage active={running} lifecycle={lifecycle}>
        <Content active={running} />
      </Stage>
      {/* Safe-area layer for readable/tappable UI (HUD, buttons). Empty by
          default: the shell never stamps a label on top of creator content —
          the starter's own title lives in Content.tsx and leaves with it. */}
      <SafeUI lifecycle={lifecycle} />
    </>
  );
}
