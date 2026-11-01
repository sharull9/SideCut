import { Schema } from "effect";
import type { Project } from "@sidecut/contracts/project";

export const LIVE_BACKGROUNDS = [
  "solid",
  "waves",
  "grid",
  "orbits",
  "rings",
  "particles",
  "rays",
  "stripes",
  "checker",
  "aurora",
  "mesh",
] as const;
const range = (min: number, max: number) =>
  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(min), Schema.isLessThanOrEqualTo(max));
const color = Schema.String.check(
  Schema.makeFilter((value) =>
    /^#[0-9a-f]{6}$/i.test(value) ? undefined : "Use a six-digit hex color.",
  ),
);
const overlay = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["banner", "takeover", "highlight"]),
  text: Schema.String,
  x: range(0, 1),
  y: range(0, 1),
  width: range(0.01, 1),
  height: range(0.01, 1),
  color,
  textColor: color,
  opacity: range(0, 1),
  enabled: Schema.Boolean,
  motion: Schema.Literals(["none", "slide", "pulse"]),
  start: range(0, 86400),
  duration: range(0.01, 86400),
});
export const LiveAssetsSchema = Schema.Struct({
  background: Schema.Literals(LIVE_BACKGROUNDS),
  color,
  accent: color,
  speed: range(0, 2),
  motion: Schema.Boolean,
  overlays: Schema.Array(overlay),
});
export type LiveAssets = typeof LiveAssetsSchema.Type;
export type LiveOverlay = typeof overlay.Type;
export const DEFAULT_LIVE_ASSETS: LiveAssets = {
  background: "solid",
  color: "#111827",
  accent: "#38bdf8",
  speed: 1,
  motion: true,
  overlays: [],
};
export function liveAssets(input: unknown): LiveAssets {
  const assets = Schema.decodeUnknownSync(LiveAssetsSchema)(input);
  if (
    assets.overlays.length > 20 ||
    new Set(assets.overlays.map((o) => o.id)).size !== assets.overlays.length
  )
    throw new Error("Use up to 20 uniquely named overlays.");
  for (const item of assets.overlays) {
    if (
      !item.id ||
      item.id.length > 100 ||
      item.text.length > 500 ||
      item.x + item.width > 1.000001 ||
      item.y + item.height > 1.000001
    )
      throw new Error("Invalid overlay text or bounds.");
  }
  return assets;
}
export function projectLiveAssets(project: Project) {
  return project.liveAssets === undefined ? null : liveAssets(project.liveAssets);
}
export function withLiveAssets(project: Project, input: unknown): Project {
  const assets = liveAssets(input);
  return { ...project, liveAssets: assets };
}
