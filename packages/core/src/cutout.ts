import type { Clip } from "@sidecut/contracts/project";

export interface RepairMask {
  shape: "rectangle" | "roundedRectangle" | "ellipse";
  mode: "include" | "exclude";
  rect: { x: number; y: number; width: number; height: number };
  cornerRadius: number;
  feather: number;
}
export interface Cutout {
  enabled: boolean;
  mode: "person" | "personAndProps";
  edgeFeather: number;
  choke: number;
  repairMasks: RepairMask[];
}
export function cutoutSettings(value: unknown): Cutout {
  if (value != null && (typeof value !== "object" || Array.isArray(value)))
    throw new Error("Cutout settings must be an object.");
  const v = (value ?? {}) as Partial<Cutout>;
  const result: Cutout = {
    enabled: true,
    mode: "personAndProps",
    edgeFeather: 2,
    choke: 0,
    repairMasks: [],
    ...v,
  };
  if (typeof result.enabled !== "boolean" || !["person", "personAndProps"].includes(result.mode))
    throw new Error("Unknown cutout mode or enabled state.");
  if (
    !Number.isFinite(result.edgeFeather) ||
    result.edgeFeather < 0 ||
    result.edgeFeather > 100 ||
    !Number.isFinite(result.choke) ||
    Math.abs(result.choke) > 100
  )
    throw new Error("Cutout feather must be 0–100 px and choke must be −100–100 px.");
  if (!Array.isArray(result.repairMasks) || result.repairMasks.length > 64)
    throw new Error("Cutout supports up to 64 repair masks.");
  result.repairMasks = result.repairMasks.map((mask) => {
    const m = Object.assign({ cornerRadius: 0, feather: 0, mode: "include" }, mask) as RepairMask;
    if (
      !m.rect ||
      !["rectangle", "roundedRectangle", "ellipse"].includes(m.shape) ||
      !["include", "exclude"].includes(m.mode)
    )
      throw new Error("Invalid cutout repair mask.");
    const { x, y, width, height } = m.rect;
    if (
      ![x, y, width, height, m.cornerRadius, m.feather].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.000001 ||
      y + height > 1.000001 ||
      m.cornerRadius < 0 ||
      m.cornerRadius > 100 ||
      m.feather < 0 ||
      m.feather > 100
    )
      throw new Error(
        "Repair rectangles must fit in source coordinates 0–1; radius and feather must be 0–100 px.",
      );
    return m;
  });
  return result;
}
export const cutoutOf = (clip: Clip) =>
  clip.video?.cutout == null ? null : cutoutSettings(clip.video.cutout);

/** Last source frame at or before time, with explicit coverage rather than held missing analysis. */
export function matteFrameIndex(
  frames: readonly { timestamp: number; duration: number }[],
  time: number,
) {
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid]!.timestamp <= time + 1e-6) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1,
    frame = frames[i];
  if (!frame || time >= frame.timestamp + frame.duration + 1e-6)
    throw new Error("Cutout analysis is incomplete at this source time. Analyse the source again.");
  return i;
}
