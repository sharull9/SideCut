import type { Clip, Project } from "@sidecut/contracts/project";
import { resolveClip } from "@sidecut/core/keyframes";
import { resolvedParams } from "@sidecut/core/effects";
import type { ClipEffect } from "@sidecut/contracts/project";
function property(value: unknown, parts: string[]): unknown {
  for (const part of parts)
    value =
      value && typeof value === "object"
        ? Object.getOwnPropertyDescriptor(value, part)?.value
        : undefined;
  return value;
}
function valueAt(clip: Clip, parameter: string, time: number) {
  const resolved = resolveClip(clip, time),
    parts = parameter.split(".");
  if (parts[1] === "effects") {
    const effects = property(resolved, [parts[0]!, "effects"]);
    const effect = Array.isArray(effects)
      ? effects.find((item: ClipEffect) => item.id === parts[2])
      : undefined;
    return effect ? resolvedParams(effect)[parts.slice(3).join(".")] : undefined;
  }
  return (
    property(resolved, parts) ??
    (parameter === "video.transform.position"
      ? { x: 0.5, y: 0.5 }
      : ["video.transform.scale", "video.opacity"].includes(parameter)
        ? 1
        : 0)
  );
}
function plainValue(clip: Clip, parameter: string, value: unknown) {
  const parts = parameter.split(".");
  if (parts[1] === "effects")
    return {
      updateEffect: {
        clipID: clip.id,
        effectID: parts[2]!,
        patch: { params: { [parts.slice(3).join(".")]: value } },
      },
    };
  let patch: unknown = value;
  for (const part of parts.toReversed()) patch = { [part]: patch };
  return { updateClip: { clipID: clip.id, patch } };
}
/** Tandem's Option-K uses the primary clip and all animated parameters. MIT fixture notice applies. */
export function toggleClipKeyframes(
  project: Project,
  selected: readonly string[],
  playhead: number,
) {
  const tracks = [...project.videoTracks, ...project.audioTracks];
  const track =
    tracks.find((item) => item.clips.some((clip) => clip.id === selected[0])) ??
    tracks.find((item) =>
      item.clips.some(
        (clip) =>
          playhead >= clip.start.seconds && playhead < clip.start.seconds + clip.duration.seconds,
      ),
    );
  const clip =
    track?.clips.find((item) => item.id === selected[0]) ??
    track?.clips.find(
      (item) =>
        playhead >= item.start.seconds && playhead < item.start.seconds + item.duration.seconds,
    );
  if (!clip || !track) throw new Error("Select a clip to add a keyframe.");
  const time = Math.max(0, Math.min(clip.duration.seconds, playhead - clip.start.seconds));
  const tolerance =
    project.settings.frameRate.denominator / project.settings.frameRate.numerator / 2;
  const here = Object.keys(clip.keyframes).filter((key) =>
    clip.keyframes[key]!.some((frame) => Math.abs(Number(frame.time) - time) <= tolerance),
  );
  const commands: unknown[] = [];
  if (here.length) {
    for (const parameter of here) {
      const frames = clip.keyframes[parameter]!,
        remaining = frames.filter((frame) => Math.abs(Number(frame.time) - time) > tolerance);
      commands.push({ setKeyframes: { clipID: clip.id, parameter, keyframes: remaining } });
      if (!remaining.length)
        commands.push(
          plainValue(
            clip,
            parameter,
            frames.find((frame) => Math.abs(Number(frame.time) - time) <= tolerance)!.value,
          ),
        );
    }
  } else {
    const animated = Object.keys(clip.keyframes).filter((key) => key.startsWith(track.kind + "."));
    const parameters = animated.length
      ? animated
      : track.kind === "audio"
        ? ["audio.gainDB"]
        : ["video.transform.position", "video.transform.scale"];
    for (const parameter of parameters) {
      const value = valueAt(clip, parameter, clip.start.seconds + time);
      if (value === undefined) continue;
      commands.push({
        setKeyframes: {
          clipID: clip.id,
          parameter,
          keyframes: [
            ...(clip.keyframes[parameter] ?? []),
            { time, value, interpolation: "easeInOut" },
          ].sort((a, b) => Number(a.time) - Number(b.time)),
        },
      });
    }
    if (
      parameters.some((key) => key.startsWith("video.transform.")) &&
      clip.video?.layoutPreset != null
    )
      commands.push({ updateClip: { clipID: clip.id, patch: { video: { layoutPreset: null } } } });
  }
  return { label: here.length ? "Remove keyframe" : "Add keyframe", commands };
}
