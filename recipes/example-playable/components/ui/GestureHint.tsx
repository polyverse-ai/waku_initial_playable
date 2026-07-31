// Standard onboarding affordance. A white dot loops a demo of the gesture the
// player should perform. Three distinct styles:
//   tap        — quick radar ping
//   long-press — ring charges inward onto a held, pressed dot (clearly ≠ tap)
//   swipe      — dot travels with a motion trail; `direction` picks the axis,
//                "left-right" oscillates back and forth
// Pointer-transparent; the parent owns visibility (flip `visible` off on first
// interaction to auto-dismiss).

export type GestureKind = "tap" | "swipe" | "long-press";
export type SwipeDirection = "up" | "down" | "left" | "right" | "left-right";

interface GestureHintProps {
  gesture: GestureKind;
  direction?: SwipeDirection; // swipe only; default "up"
  visible?: boolean;
  label?: string;
  x?: string; // CSS left, default "50%"
  y?: string; // CSS top, default "50%"
}

export function GestureHint({
  gesture,
  direction = "up",
  visible = true,
  label,
  x = "50%",
  y = "50%",
}: GestureHintProps) {
  const isSwipe = gesture === "swipe";
  return (
    <div className="gesture-hint-layer" data-visible={visible ? "true" : "false"} aria-hidden="true">
      <div
        className="gesture-hint"
        data-gesture={gesture}
        data-direction={isSwipe ? direction : undefined}
        style={{ left: x, top: y }}
      >
        {isSwipe ? (
          <>
            <span className="gesture-hint-trail t2" />
            <span className="gesture-hint-trail t1" />
          </>
        ) : null}
        <span className="gesture-hint-ring" />
        <span className="gesture-hint-dot" />
        {label ? <span className="gesture-hint-label">{label}</span> : null}
      </div>
    </div>
  );
}
