// Geometry and ordering from TandemRender/Effects.swift and FrameComposer.swift.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { ClipEffect } from "@sidecut/contracts/project";
import { resolvedParams } from "./effects";
export const pixelScale = (width: number, height: number) =>
  Math.max(1, Math.min(width, height)) / 1080;
export function layerStyles(effects: readonly ClipEffect[], width: number, height: number) {
  const params = (type: string) => {
    const fx = effects.find((f) => f.enabled !== false && f.type === type);
    return fx ? resolvedParams(fx) : null;
  };
  const corners = params("roundedCorners"),
    border = params("border"),
    shadow = params("dropShadow"),
    px = pixelScale(width, height);
  const color = (value: unknown, fallback: readonly number[]) => {
    const c = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return ["r", "g", "b", "a"].map((key, i) =>
      typeof c[key] === "number" ? Math.max(0, Math.min(1, c[key])) : fallback[i]!,
    ) as [number, number, number, number];
  };
  const distance = Number(shadow?.distance ?? 0) * px,
    angle = (Number(shadow?.angle ?? 135) * Math.PI) / 180;
  return {
    radius: Math.max(0, Number(corners?.radius ?? 0) * px),
    border: Math.max(0, Number(border?.width ?? 0) * px),
    borderColor: color(border?.color, [1, 1, 1, 1]),
    shadow: {
      dx: -distance * Math.cos(angle),
      dy: distance * Math.sin(angle),
      blur: Math.max(0, Number(shadow?.blur ?? 0) * px),
      opacity: Math.max(0, Math.min(1, Number(shadow?.opacity ?? 0) / 100)),
      color: color(shadow?.color, [0, 0, 0, 1]),
    },
  };
}
export type LayerStyles = ReturnType<typeof layerStyles>;
