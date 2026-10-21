import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

interface PanelDividerProps {
  label: string;
  controls: string;
  orientation: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}

export function PanelDivider({
  label,
  controls,
  orientation,
  value,
  min,
  max,
  reverse = false,
  onChange,
  onReset,
}: PanelDividerProps) {
  const drag = useRef<{ pointer: number; start: number; value: number } | null>(null);
  const vertical = orientation === "vertical";

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const less = vertical ? "ArrowLeft" : "ArrowUp";
    const more = vertical ? "ArrowRight" : "ArrowDown";
    if ([less, more, "Home", "End", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Enter") {
        onReset();
        return;
      }
      const step = event.shiftKey ? 32 : 8;
      const next =
        event.key === "Home"
          ? min
          : event.key === "End"
            ? max
            : value + (event.key === less ? -1 : 1) * (reverse ? -1 : 1) * step;
      onChange(Math.max(min, Math.min(max, next)));
      // Persistence is handled by the panel state effect after this update.
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    drag.current = null;
    if (cancelled) onChange(active.value);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      title="Drag to resize. Arrow keys adjust. Enter or double-click resets."
      className="editor-divider"
      data-orientation={orientation}
      onKeyDown={keyDown}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          start: vertical ? event.clientX : event.clientY,
          value,
        };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId) return;
        const position = vertical ? event.clientX : event.clientY;
        onChange(
          Math.max(
            min,
            Math.min(max, active.value + (position - active.start) * (reverse ? -1 : 1)),
          ),
        );
      }}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
    />
  );
}
