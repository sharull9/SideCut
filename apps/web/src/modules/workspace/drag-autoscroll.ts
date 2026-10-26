import { useCallback, useEffect, useRef } from "react";

export function edgeScrollVelocity(x: number, left: number, right: number) {
  const edge = Math.min(48, Math.max(0, (right - left) / 2));
  if (!edge) return 0;
  if (x < left + edge) return -720 * Math.min(1, Math.max(0, (left + edge - x) / edge));
  if (x > right - edge) return 720 * Math.min(1, Math.max(0, (x - right + edge) / edge));
  return 0;
}

/** Continue a captured drag while the pointer rests beside the viewport edge. */
export function useDragAutoScroll() {
  const frame = useRef<number | null>(null);
  const active = useRef<{ element: HTMLElement; x: number; update: () => void } | null>(null);
  const last = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    active.current = null;
    last.current = null;
  }, []);
  const tick = useCallback(
    function advance(now: number) {
      frame.current = null;
      const value = active.current;
      if (!value?.element.isConnected) return stop();
      const bounds = value.element.getBoundingClientRect();
      const velocity = edgeScrollVelocity(value.x, bounds.left + 248, bounds.right);
      const elapsed = Math.min(40, Math.max(0, now - (last.current ?? now - 16)));
      last.current = now;
      const before = value.element.scrollLeft;
      value.element.scrollLeft += (velocity * elapsed) / 1000;
      if (value.element.scrollLeft !== before) value.update();
      if (active.current) frame.current = requestAnimationFrame(advance);
    },
    [stop],
  );
  const track = (element: HTMLElement | null, x: number, update: () => void) => {
    if (!element) return stop();
    active.current = { element, x, update };
    if (frame.current == null) frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => stop, [stop]);
  return { track, stop };
}
