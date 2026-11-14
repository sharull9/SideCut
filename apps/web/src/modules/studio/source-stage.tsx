import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  moveLayout,
  resizeLayout,
  sourceRect,
  type Corner,
  type SourceLayout,
} from "./source-layout";

export type StageSource = {
  id: string;
  label: string;
  layout: SourceLayout;
  /** Width / height of the live picture. */
  aspect: number;
};

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

type Gesture = {
  id: string;
  pointerId: number;
  corner: Corner | null;
  start: SourceLayout;
  origin: { x: number; y: number };
  aspect: number;
};

/**
 * Handles laid over the program canvas: drag a source to move it, drag a corner to resize it.
 * Hold Alt while dragging to turn off edge snapping. Arrow keys nudge the focused source.
 */
export function SourceStage({
  sources,
  canvasAspect,
  selected,
  onSelect,
  onChange,
}: {
  sources: readonly StageSource[];
  canvasAspect: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, layout: SourceLayout) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const point = (event: PointerEvent) => {
    const box = stage.current!.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
  };
  const begin = (event: PointerEvent<HTMLElement>, source: StageSource, corner: Corner | null) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    (event.currentTarget.closest("[data-source]") as HTMLElement | null)?.focus();
    onSelect(source.id);
    gesture.current = {
      id: source.id,
      pointerId: event.pointerId,
      corner,
      start: source.layout,
      origin: point(event),
      aspect: source.aspect,
    };
  };
  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const at = point(event);
    onChange(
      active.id,
      active.corner
        ? resizeLayout(active.start, active.corner, at, canvasAspect, active.aspect)
        : moveLayout(
            active.start,
            at.x - active.origin.x,
            at.y - active.origin.y,
            canvasAspect,
            active.aspect,
            !event.altKey,
          ),
    );
  };
  const end = (event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
  };
  const nudge = (event: KeyboardEvent, source: StageSource) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange(
      source.id,
      moveLayout(source.layout, delta[0]!, delta[1]!, canvasAspect, source.aspect, false),
    );
  };

  return (
    <div
      ref={stage}
      className="studio-stage"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {sources.map((source) => {
        const rect = sourceRect(source.layout, canvasAspect, source.aspect);
        const isSelected = selected === source.id;
        return (
          <div
            key={source.id}
            data-source
            data-selected={isSelected || undefined}
            role="group"
            tabIndex={0}
            aria-label={`${source.label} position. Drag to move, drag a corner to resize, or use the arrow keys.`}
            className="studio-source-box"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
            onPointerDown={(event) => begin(event, source, null)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onFocus={() => onSelect(source.id)}
            onKeyDown={(event) => nudge(event, source)}
          >
            {/* Drawn from an attribute so the panel's source list stays the only text match. */}
            <span className="studio-source-tag" data-label={source.label} aria-hidden />
            {isSelected &&
              CORNERS.map((corner) => (
                <span
                  key={corner}
                  data-corner={corner}
                  className="studio-source-handle"
                  aria-hidden
                  onPointerDown={(event) => begin(event, source, corner)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
