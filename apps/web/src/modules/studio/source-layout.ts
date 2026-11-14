/**
 * Where a live source sits on the program canvas.
 *
 * Positions are fractions of the canvas, so a layout survives output size changes. Only the
 * width is stored: the height always follows the source's own aspect, which keeps a shared
 * window that changes shape from being stretched.
 */
export type SourceLayout = { x: number; y: number; w: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = "nw" | "ne" | "sw" | "se";

const MIN_WIDTH = 0.05;
const MAX_WIDTH = 2;
/** How much of a source must stay on the canvas so it can always be grabbed again. */
const KEEP_VISIBLE = 0.05;
const SNAP = 0.015;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** canvasAspect and sourceAspect are width / height. */
export function sourceRect(layout: SourceLayout, canvasAspect: number, sourceAspect: number): Rect {
  return { ...layout, h: (layout.w * canvasAspect) / sourceAspect };
}

function keepOnCanvas(rect: Rect): SourceLayout {
  return {
    x: clamp(rect.x, KEEP_VISIBLE - rect.w, 1 - KEEP_VISIBLE),
    y: clamp(rect.y, KEEP_VISIBLE - rect.h, 1 - KEEP_VISIBLE),
    w: rect.w,
  };
}

/**
 * The first screen fits the whole frame. Later screens sit side by side in the top half so a
 * new share never hides the one already on air. Cameras stack picture-in-picture bottom right.
 */
export function defaultLayout(
  kind: "camera" | "screen",
  /** How many sources of this kind are already on the canvas. */
  index: number,
  canvasAspect: number,
  sourceAspect: number,
): SourceLayout {
  if (kind === "camera") {
    const w = 0.25;
    const h = (w * canvasAspect) / sourceAspect;
    const marginX = 0.02;
    const marginY = marginX * canvasAspect;
    return keepOnCanvas({ x: 1 - w - marginX, y: 1 - (h + marginY) * (index + 1), w, h });
  }
  if (index === 0) {
    const w = Math.min(1, sourceAspect / canvasAspect);
    const h = (w * canvasAspect) / sourceAspect;
    return { x: (1 - w) / 2, y: (1 - h) / 2, w };
  }
  const w = Math.min(0.5, (0.5 * sourceAspect) / canvasAspect);
  const h = (w * canvasAspect) / sourceAspect;
  const column = (index - 1) % 2;
  const row = Math.floor((index - 1) / 2);
  return keepOnCanvas({ x: column * 0.5 + (0.5 - w) / 2, y: row * 0.08 + (0.5 - h) / 2, w, h });
}

/** Moves a source and snaps its edges and centre to the canvas edges and centre. */
export function moveLayout(
  start: SourceLayout,
  dx: number,
  dy: number,
  canvasAspect: number,
  sourceAspect: number,
  snap = true,
): SourceLayout {
  const { w, h } = sourceRect(start, canvasAspect, sourceAspect);
  const snapTo = (value: number, size: number) => {
    if (!snap) return value;
    for (const target of [0, 1 - size, (1 - size) / 2])
      if (Math.abs(value - target) < SNAP) return target;
    return value;
  };
  return keepOnCanvas({ x: snapTo(start.x + dx, w), y: snapTo(start.y + dy, h), w, h });
}

/** Resizes from a corner, keeping the opposite corner fixed and the source's aspect. */
export function resizeLayout(
  start: SourceLayout,
  corner: Corner,
  /** Pointer position as canvas fractions. */
  pointer: { x: number; y: number },
  canvasAspect: number,
  sourceAspect: number,
): SourceLayout {
  const rect = sourceRect(start, canvasAspect, sourceAspect);
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";
  const anchorX = west ? rect.x + rect.w : rect.x;
  const anchorY = north ? rect.y + rect.h : rect.y;
  const fromX = west ? anchorX - pointer.x : pointer.x - anchorX;
  const fromY = ((north ? anchorY - pointer.y : pointer.y - anchorY) * sourceAspect) / canvasAspect;
  // Both distances are in canvas widths, so the box's diagonal is (1, 1): project onto it.
  const w = clamp((fromX + fromY) / 2, MIN_WIDTH, MAX_WIDTH);
  const h = (w * canvasAspect) / sourceAspect;
  return keepOnCanvas({ x: west ? anchorX - w : anchorX, y: north ? anchorY - h : anchorY, w, h });
}

/** Fits a source inside the whole canvas, centred. */
export function fitLayout(canvasAspect: number, sourceAspect: number): SourceLayout {
  return defaultLayout("screen", 0, canvasAspect, sourceAspect);
}

/** Covers the whole canvas, cropping whatever overflows. */
export function fillLayout(canvasAspect: number, sourceAspect: number): SourceLayout {
  const w = Math.max(1, sourceAspect / canvasAspect);
  const h = (w * canvasAspect) / sourceAspect;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w };
}
