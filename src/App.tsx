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
      <Stage active={running}>
        <Content active={running} />
      </Stage>
      <SafeUI lifecycle={lifecycle}>
        <section className="safe-center">
          <h1 className="text-sm font-semibold tracking-[0.18em] text-[var(--muted)]">
            Minimal Playable
          </h1>
        </section>
      </SafeUI>
    </>
  );
}
