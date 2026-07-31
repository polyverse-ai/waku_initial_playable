// Disable mobile WebView gestures that interfere with playable content.
// Elements with data-allow-gesture, form fields, and editable content keep their defaults.

const ALLOW_ATTR = "data-allow-gesture";

export function lockGestures() {
  window.addEventListener("contextmenu", maybePrevent, { passive: false });
  window.addEventListener("gesturestart", prevent, { passive: false });
  window.addEventListener("gesturechange", prevent, { passive: false });
  window.addEventListener("gestureend", prevent, { passive: false });
  window.addEventListener("dragstart", prevent, { passive: false });
  window.addEventListener("dragover", prevent, { passive: false });
  window.addEventListener("drop", prevent, { passive: false });
  document.addEventListener("selectstart", maybePrevent, { passive: false });
  window.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1 && !inAllowed(event.target)) event.preventDefault();
    },
    { passive: false },
  );
}

function prevent(event: Event) {
  event.preventDefault();
}

function maybePrevent(event: Event) {
  if (!inAllowed(event.target)) event.preventDefault();
}

function inAllowed(node: EventTarget | null) {
  if (!(node instanceof Element)) return false;
  return node.closest(`[${ALLOW_ATTR}], input, textarea, [contenteditable="true"]`) != null;
}
