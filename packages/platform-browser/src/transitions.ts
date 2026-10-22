// Timing/geometry ported from TandemRender/Transitions.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { directionVector, transitionProgress } from "@sidecut/core/transitions";
export const surface = (width: number, height: number) => {
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  const context = value.getContext("2d");
  if (!context) throw new Error("Canvas composition is unavailable.");
  return { value, context };
};
function mix(
  a: HTMLCanvasElement | null,
  b: HTMLCanvasElement | null,
  p: number,
  width: number,
  height: number,
) {
  const out = surface(width, height);
  out.context.globalCompositeOperation = "lighter";
  if (a) {
    out.context.globalAlpha = 1 - p;
    out.context.drawImage(a, 0, 0);
  }
  if (b) {
    out.context.globalAlpha = p;
    out.context.drawImage(b, 0, 0);
  }
  out.context.globalAlpha = 1;
  out.context.globalCompositeOperation = "source-over";
  return out.value;
}
function darken(source: HTMLCanvasElement | null, level: number, width: number, height: number) {
  const out = surface(width, height);
  if (!source) return out.value;
  out.context.drawImage(source, 0, 0);
  const pixels = out.context.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4)
    for (let c = 0; c < 3; c++) pixels.data[i + c]! *= Math.max(0, level);
  out.context.putImageData(pixels, 0, 0);
  return out.value;
}
function zoom(source: HTMLCanvasElement | null, scale: number, width: number, height: number) {
  const out = surface(width, height);
  if (source)
    out.context.drawImage(
      source,
      ((1 - scale) * width) / 2,
      ((1 - scale) * height) / 2,
      width * scale,
      height * scale,
    );
  return out.value;
}
// Nine-tap motion/zoom blur approximates the proprietary Core Image blur kernels.
function motion(source: HTMLCanvasElement, radius: number, dx: number, dy: number, radial = false) {
  if (radius <= 1) return source;
  const { width, height } = source,
    out = surface(width, height);
  out.context.globalCompositeOperation = "lighter";
  out.context.globalAlpha = 1 / 9;
  for (let i = 0; i < 9; i++) {
    if (radial) {
      const scale = 1 + ((i / 8) * radius) / 100;
      out.context.drawImage(
        source,
        ((1 - scale) * width) / 2,
        ((1 - scale) * height) / 2,
        width * scale,
        height * scale,
      );
    } else {
      const x = dx * (i / 8 - 0.5) * 2 * radius,
        y = dy * (i / 8 - 0.5) * 2 * radius;
      out.context.drawImage(source, x, y);
      if (x > 0) out.context.drawImage(source, 0, 0, 1, height, 0, y, x, height);
      if (x < 0) out.context.drawImage(source, width - 1, 0, 1, height, width + x, y, -x, height);
      if (y > 0) out.context.drawImage(source, 0, 0, width, 1, x, 0, width, y);
      if (y < 0) out.context.drawImage(source, 0, height - 1, width, 1, x, height + y, width, -y);
    }
  }
  return out.value;
}
export function renderTransition(
  from: HTMLCanvasElement | null,
  to: HTMLCanvasElement | null,
  transition: Record<string, unknown>,
  progress: number,
  width: number,
  height: number,
  duration: number,
  frameDuration: number,
): HTMLCanvasElement {
  const p = Math.max(0, Math.min(1, progress)),
    type = String(transition.type),
    e = transitionProgress(type, p),
    [dx, dy] = directionVector(transition.direction);
  if (type === "dissolve") return mix(from, to, p, width, height);
  if (type === "fadeToBlack" || type === "fadeFromBlack")
    return from && (!to || p < 0.5)
      ? darken(from, to ? 1 - 2 * p : 1 - p, width, height)
      : darken(to, from ? 2 * p - 1 : p, width, height);
  if (type === "push" || type === "slide" || type === "cutSlide") {
    const out = surface(width, height),
      amount = type === "slide" ? 0 : e;
    if (from) out.context.drawImage(from, dx * amount * width, dy * amount * height);
    if (to) out.context.drawImage(to, dx * (e - 1) * width, dy * (e - 1) * height);
    if (type !== "cutSlide") return out.value;
    const halfFrame = frameDuration / duration / 2,
      travel = Math.abs(
        transitionProgress(type, p + halfFrame / 2) - transitionProgress(type, p - halfFrame / 2),
      ),
      extent = dx ? width : height;
    const length = (travel * extent) / 3;
    return length > 1 ? motion(out.value, Math.min(length / 2, extent * 0.02), dx, dy) : out.value;
  }
  if (type === "zoom") {
    const swap = e < 0.35 ? 0 : e > 0.65 ? 1 : transitionProgress("zoom", (e - 0.35) / 0.3);
    return motion(
      mix(zoom(from, 1 + e, width, height), zoom(to, 2 - e, width, height), swap, width, height),
      Math.min(width, height) * 0.02 * (1 - Math.abs(2 * e - 1)),
      0,
      0,
      true,
    );
  }
  if (type === "wipe") {
    const a = surface(width, height),
      b = surface(width, height);
    if (from) a.context.drawImage(from, 0, 0);
    if (to) b.context.drawImage(to, 0, 0);
    const own = a.context.getImageData(0, 0, width, height),
      other = b.context.getImageData(0, 0, width, height),
      length = dx ? width : height,
      soft = length * 0.06,
      edge = -soft + e * (length + 2 * soft);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const position = dx
          ? dx > 0
            ? x + 0.5
            : width - x - 0.5
          : dy > 0
            ? y + 0.5
            : height - y - 0.5;
        const weight = Math.max(0, Math.min(1, (edge + soft / 2 - position) / soft)),
          i = (y * width + x) * 4,
          aa = (own.data[i + 3]! / 255) * (1 - weight),
          ba = (other.data[i + 3]! / 255) * weight,
          alpha = aa + ba;
        for (let c = 0; c < 3; c++)
          own.data[i + c] =
            alpha > 0 ? (own.data[i + c]! * aa + other.data[i + c]! * ba) / alpha : 0;
        own.data[i + 3] = alpha * 255;
      }
    a.context.putImageData(own, 0, 0);
    return a.value;
  }
  throw new Error(`Unsupported transition ${type}.`);
}
