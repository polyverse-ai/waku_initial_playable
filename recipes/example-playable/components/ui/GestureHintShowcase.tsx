import { GestureHint, type GestureKind, type SwipeDirection } from "./GestureHint";

// Demo-only: every distinct GestureHint style at once, labeled, framing the
// center. swipe is one style (direction differs); "left-right" oscillates.
const ITEMS: { gesture: GestureKind; direction?: SwipeDirection; label: string; x: string; y: string }[] = [
  { gesture: "tap", label: "tap", x: "28%", y: "20%" },
  { gesture: "long-press", label: "long press", x: "72%", y: "20%" },
  { gesture: "swipe", direction: "up", label: "swipe", x: "28%", y: "82%" },
  { gesture: "swipe", direction: "left-right", label: "swipe ↔", x: "72%", y: "82%" },
];

export function GestureHintShowcase({ visible = true }: { visible?: boolean }) {
  return (
    <>
      {ITEMS.map((it) => (
        <GestureHint
          key={it.label}
          gesture={it.gesture}
          direction={it.direction}
          visible={visible}
          label={it.label}
          x={it.x}
          y={it.y}
        />
      ))}
    </>
  );
}
