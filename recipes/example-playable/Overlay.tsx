import { type ReactNode } from "react";
import { createPortal } from "react-dom";

interface OverlayProps {
  /** When true, the overlay is mounted into the full-viewport layer above the safe zone. */
  open: boolean;
  children: ReactNode;
  /**
   * Fires when the dim backdrop itself (not the panel) is pressed — wire it for
   * tap-to-dismiss. Omit to make the overlay non-dismissable (e.g. an
   * end-of-run report that must be acted on).
   */
  onDismiss?: () => void;
}

/**
 * Template-owned full-viewport overlay layer — a structural sibling to
 * `.bg-layer` and `.safe-ui`, NOT a generated component (so it lives in
 * `src/`, not `src/components/`).
 *
 * Why it exists: a popup drawn with `position: absolute` inside `.safe-center`
 * only dims the safe zone, leaving the notch, screen edges, rounded corners and
 * host-chrome band bright — the end popup then looks pasted on. This overlay's
 * dim backdrop covers the ENTIRE viewport, while its centered panel stays inside
 * the safe area (its padding equals the same insets as `.safe-ui`), so the
 * screen dims globally but the dialog text never slides under the notch or
 * behind host chrome.
 *
 * Rendered via portal to the `#root` design canvas (not the `.safe-center` /
 * `.safe-ui` stacking context, so it can dim the whole screen) — but still
 * inside `#root`, so it rides the canvas's uniform scale instead of escaping it.
 */
export function Overlay({ open, children, onDismiss }: OverlayProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="overlay-backdrop"
      onPointerDown={
        onDismiss
          ? (e) => {
              if (e.target === e.currentTarget) onDismiss();
            }
          : undefined
      }
    >
      <div className="overlay-panel">{children}</div>
    </div>,
    document.getElementById("root") ?? document.body,
  );
}
