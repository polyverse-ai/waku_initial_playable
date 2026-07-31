import { useEffect, useRef, useState, type PointerEventHandler } from "react";
import { t } from "./i18n";
import { composeWakuComment, uploadImageForShare } from "../../src/waku/polyverse";
import { renderResultCard } from "./sharecard";
import { createTiltController } from "./devicemotion";
import { Overlay } from "./Overlay";
import { GestureHintShowcase } from "./components/ui/GestureHintShowcase";
import type { PlayableState, ResultState } from "./usePlayableState";

// Share default: render THIS run's result CARD → upload it to a permanent public
// URL (pv.assets.upload, the same channel the latest iOS app uses) → post an
// IMAGE comment carrying that URL, with the result text as the caption. Upload
// failure (older host, offline, oversize) falls back to a text-only comment, so
// the button never lies. Set this to false to force text-only. Needs manifest
// assets.write. Never share a bundled decorative asset as if it were the result.
const SHARE_WITH_CARD = true;

interface DefaultPlayableProps {
  state: PlayableState;
  onPrimaryPointer: PointerEventHandler<HTMLButtonElement>;
  onReplay: () => void;
}

export function DefaultPlayable({ state, onPrimaryPointer, onReplay }: DefaultPlayableProps) {
  const targetRef = useRef<HTMLButtonElement>(null);

  // The number leans to follow the device gyroscope, so tilting visibly moves it.
  useEffect(() => {
    const ctrl = createTiltController({
      onTilt: (x, y) => {
        const el = targetRef.current;
        if (el) el.style.transform = `perspective(620px) rotateY(${x * 26}deg) rotateX(${-y * 26}deg) rotate(${x * 9}deg)`;
      },
    });
    void ctrl.requestPermission().then(() => ctrl.start());
    return () => ctrl.destroy();
  }, []);

  return (
    <>
      <button
        id="core-target"
        ref={targetRef}
        className={`core-target ${state.feedback === "on" ? "is-hit" : ""}`}
        data-testid="core-target"
        type="button"
        style={{ transition: "transform 140ms ease" }}
        aria-label={`${t("core_number_label")} ${state.score}`}
        onPointerDown={onPrimaryPointer}
      >
        <div id="signal-core" className="signal-core">
          {state.score}
        </div>
      </button>

      {/* Demo: show every guidance style at once while waiting for first input. */}
      <GestureHintShowcase visible={state.phase === "ready" && !state.hasFirstInteraction} />

      <ResultPanel
        result={state.result}
        completedInSec={state.completedInSec}
        hidden={state.phase !== "result"}
        onReplay={onReplay}
      />
    </>
  );
}

interface ResultPanelProps {
  result: ResultState | null;
  completedInSec: number;
  hidden: boolean;
  onReplay: () => void;
}

type ShareStatus = "idle" | "busy" | "done" | "unavailable";

function ResultPanel({ result, completedInSec, hidden, onReplay }: ResultPanelProps) {
  const success = result?.outcome !== "failed";
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");

  // Share to comments. Default text-only; with SHARE_WITH_CARD, render this run's
  // card → upload → image comment, falling back to text on upload failure.
  const handleShare = async () => {
    if (shareStatus === "busy" || shareStatus === "done") return;
    setShareStatus("busy");
    const text = t("share_comment_text").replace("{seconds}", completedInSec.toFixed(1));
    try {
      let imageUrl: string | undefined;
      if (SHARE_WITH_CARD) {
        // Render THIS run to a card, upload it, post the returned public URL.
        const dataUrl = renderResultCard({
          title: t("result_success_kicker"),
          stat: `${completedInSec.toFixed(1)}s`,
          caption: text,
        });
        imageUrl = (await uploadImageForShare(dataUrl)) ?? undefined; // null → fall back to text-only
      }
      await composeWakuComment(text, imageUrl);
      setShareStatus("done");
    } catch {
      setShareStatus("unavailable");
    }
  };

  return (
    <Overlay open={!hidden}>
      <section
        id="result-panel"
        className="result-panel text-center"
        data-testid="result-panel"
        role="dialog"
        aria-live="assertive"
      >
        <p className="text-xs font-bold uppercase tracking-[0.28em]" style={{ color: "var(--accent-strong)" }}>
          {success ? t("result_success_kicker") : t("result_fail_kicker")}
        </p>
        <h2 className="mt-3 text-3xl font-black leading-tight text-[var(--text)]">
          {success ? t("result_success_title") : t("result_fail_title")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {t("result_time").replace("{seconds}", completedInSec.toFixed(1))}
        </p>
        <button className="replay-button mt-6 w-full" type="button" onClick={onReplay}>
          {t("action_replay")}
        </button>
        {success && (
          <button
            id="share-comment"
            className="replay-button mt-3 w-full"
            data-testid="share-comment"
            type="button"
            disabled={shareStatus === "busy" || shareStatus === "unavailable"}
            onClick={handleShare}
          >
            {shareStatus === "done"
              ? t("share_comment_done")
              : shareStatus === "unavailable"
                ? t("share_comment_unavailable")
                : t("action_share_comment")}
          </button>
        )}
      </section>
    </Overlay>
  );
}
