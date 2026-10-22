// Ported from TandemCore/Keyframes.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, ParamValue } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";

export const fixedParameters = [
  "video.transform.position",
  "video.transform.scale",
  "video.transform.rotation",
  "video.opacity",
  "video.crop.left",
  "video.crop.top",
  "video.crop.right",
  "video.crop.bottom",
  "audio.gainDB",
];
export const knownParameter = (path: string) =>
  fixedParameters.includes(path) ||
  path.startsWith("video.effects.") ||
  path.startsWith("audio.effects.");
export type Interpolation = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";
export function easing(kind: Interpolation, t: number): number {
  t = Math.min(1, Math.max(0, t));
  switch (kind) {
    case "hold":
      return 0;
    case "easeIn":
      return t ** 3;
    case "easeOut":
      return 1 - (1 - t) ** 3;
    case "easeInOut":
      return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    default:
      return t;
  }
}
export function interpolate(a: ParamValue, b: ParamValue, t: number, circular = false): ParamValue {
  if (typeof a === "number" && typeof b === "number") {
    if (!circular) return a + (b - a) * t;
    let delta = (b - a) % 360;
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;
    return (((a + delta * t) % 360) + 360) % 360;
  }
  if (typeof a === "object" && typeof b === "object") {
    if ("x" in a && "x" in b)
      return {
        x: Number(a.x) + (Number(b.x) - Number(a.x)) * t,
        y: Number(a.y) + (Number(b.y) - Number(a.y)) * t,
      };
    if ("r" in a && "r" in b)
      return {
        r: Number(a.r) + (Number(b.r) - Number(a.r)) * t,
        g: Number(a.g) + (Number(b.g) - Number(a.g)) * t,
        b: Number(a.b) + (Number(b.b) - Number(a.b)) * t,
        a: Number(a.a ?? 1) + (Number(b.a ?? 1) - Number(a.a ?? 1)) * t,
      };
  }
  return t < 1 ? a : b;
}
export function keyframeValue(
  list: Clip["keyframes"][string],
  time: number,
  circular = false,
): ParamValue | undefined {
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => Number(a.time) - Number(b.time));
  const first = sorted[0]!,
    last = sorted.at(-1)!;
  const ticks = Time.fromSeconds(time).flicks;
  if (ticks <= Time.fromSeconds(Number(first.time)).flicks || sorted.length === 1)
    return first.value as ParamValue;
  if (ticks >= Time.fromSeconds(Number(last.time)).flicks) return last.value as ParamValue;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!,
      b = sorted[i + 1]!;
    const start = Time.fromSeconds(Number(a.time)).flicks,
      stop = Time.fromSeconds(Number(b.time)).flicks;
    if (ticks >= start && ticks < stop)
      return interpolate(
        a.value as ParamValue,
        b.value as ParamValue,
        easing(
          (a.interpolation ?? "easeInOut") as Interpolation,
          Number(ticks - start) / Number(stop - start),
        ),
        circular,
      );
  }
  return last.value as ParamValue;
}
export function resolveClip(clip: Clip, timelineTime: number): Clip {
  let video = { ...(clip.video ?? {}) },
    audio = { ...(clip.audio ?? {}) };
  for (const [path, list] of Object.entries(clip.keyframes)) {
    const parts = path.split(".");
    const properties = parts[0] === "video" ? video : parts[0] === "audio" ? audio : null;
    if (!properties) continue;
    const effects = Array.isArray(properties.effects)
      ? (properties.effects as NonNullable<Clip["video"]>[])
      : [];
    const effect = effects.find((fx) => fx.id === parts[2]);
    const circular =
      parts[0] === "video" &&
      effect?.type === "colorWheels" &&
      ["shadowsHue", "midtonesHue", "highlightsHue"].includes(parts.slice(3).join("."));
    const value = keyframeValue(list, timelineTime - clip.start.seconds, circular);
    if (value === undefined) continue;
    const numeric = typeof value === "number";
    if (fixedParameters.includes(path)) {
      if (
        path === "video.transform.position"
          ? typeof value !== "object" || !("x" in value)
          : !numeric
      )
        continue;
      if (parts.length === 3)
        properties[parts[1]!] = {
          ...((properties[parts[1]!] as NonNullable<Clip["video"]>) ?? {}),
          [parts[2]!]: value,
        };
      else properties[parts[1]!] = value;
    } else if (parts[1] === "effects" && effect && parts.length >= 4) {
      properties.effects = effects.map((fx) =>
        fx !== effect
          ? fx
          : {
              ...fx,
              params: {
                ...((fx.params as NonNullable<Clip["video"]>) ?? {}),
                [parts.slice(3).join(".")]: value,
              },
            },
      );
    }
  }
  return { ...clip, video, audio };
}
