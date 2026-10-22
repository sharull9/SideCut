import { audioSegments, enabledTracks } from "./audio-plan";
import { audioEffectIssue } from "./audio-processing";
import { transitionWindow } from "./transitions";
import { effectIssue } from "./color-processing";
import { effectsOf } from "./effect-editing";
import type { ClipEffect } from "@sidecut/contracts/project";
import { resolveClip } from "./keyframes";
import type { Project, Clip, Track } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
export function projectDuration(project: Project): Time {
  return new Time(
    [...project.videoTracks, ...project.audioTracks]
      .flatMap((track) => track.clips)
      .reduce(
        (end, clip) =>
          clip.start.flicks + clip.duration.flicks > end
            ? clip.start.flicks + clip.duration.flicks
            : end,
        0n,
      ),
  );
}

export interface ActiveClip {
  clip: Clip;
  track: Track;
}
export { enabledTracks } from "./audio-plan";
export function activeClips(project: Project, time: number, kind: "video" | "audio"): ActiveClip[] {
  return enabledTracks(project, kind).flatMap((track) =>
    track.clips
      .filter(
        (clip) =>
          clip.enabled &&
          clip.start.seconds <= time &&
          time < clip.start.seconds + clip.duration.seconds &&
          !(kind === "audio" && (clip.audio?.muted === true || clip.freezeFrame)),
      )
      .map((clip) => ({ track, clip })),
  );
}

export function sourceTime(clip: Clip, time: number): number {
  return (
    clip.sourceStart.seconds + (clip.freezeFrame ? 0 : (time - clip.start.seconds) * clip.speed)
  );
}

// Picture holds its first/last decodable frame. Audio reads only the real source interval.
export function pictureTime(project: Project, clip: Clip, time: number): number {
  const reference = clip.content.media;
  const item = project.media.find(
    (m) =>
      m.id ===
      (reference && typeof reference === "object" && "mediaID" in reference
        ? reference.mediaID
        : null),
  );
  return Math.max(
    0,
    Math.min(
      sourceTime(clip, time),
      item?.duration ? Math.max(0, item.duration.seconds - 0.000001) : Infinity,
    ),
  );
}
export function audioRange(project: Project, clip: Clip, fromTimeline = clip.start.seconds) {
  if (clip.freezeFrame) return null;
  const reference = clip.content.media;
  const item = project.media.find(
    (m) =>
      m.id ===
      (reference && typeof reference === "object" && "mediaID" in reference
        ? reference.mediaID
        : null),
  );
  const from = Math.max(0, sourceTime(clip, fromTimeline)),
    to = Math.min(
      item?.duration?.seconds ?? Infinity,
      clip.sourceStart.seconds + clip.duration.seconds * clip.speed,
    );
  return to > from ? { from, to } : null;
}

export function previewIssue(project: Project, time: number): string | null {
  const video = framePlan(project, time).layers.map((layer) => ({
    clip: layer.clip,
    track: project.videoTracks.find((t) => t.id === layer.trackID)!,
  }));
  const audio = activeClips(project, time, "audio");
  for (const { clip, track } of [...video, ...audio]) {
    const reference = clip.content.media;
    const mediaID =
      reference && typeof reference === "object" && "mediaID" in reference
        ? reference.mediaID
        : null;
    if (track.kind === "video") {
      const problem = effectIssue([
        ...((project.media.find((item) => item.id === mediaID)?.look ??
          []) as readonly ClipEffect[]),
        ...effectsOf(resolveClip(clip, time), "video"),
      ]);
      if (problem) return problem;
    }
    if (track.kind === "audio") {
      const problem = audioEffectIssue(clip);
      if (problem) return problem;
    }
    if (
      (track.kind === "video"
        ? !supportedPicture(resolveClip(clip, time))
        : clip.content.media == null) ||
      (track.kind === "video" &&
        clip.audio &&
        Object.entries(clip.audio).some(
          ([key, value]) =>
            !(
              (["muted"].includes(key) && value === false) ||
              (["gainDB", "pan", "fadeIn", "fadeOut", "voiceIsolation"].includes(key) &&
                value === 0) ||
              (key === "effects" && Array.isArray(value) && value.length === 0) ||
              (key === "normalizeTo" && value === null)
            ),
        ))
    )
      return "This clip needs rendering features that are not available in the source preview yet. Cutout, effects, and sound processing need later renderers. Audio speed changes need pitch correction; speech levelling needs source analysis.";
  }
  return null;
}

export function exportPlan(project: Project) {
  const duration = projectDuration(project).seconds;
  if (duration <= 0) throw new Error("Place a source before exporting.");
  if (duration > 300)
    throw new Error("The first browser exporter supports sequences up to five minutes.");
  const fps = project.settings.frameRate.numerator / project.settings.frameRate.denominator;
  if (fps < 1 || fps > 60)
    throw new Error("Browser export currently supports frame rates from 1 to 60 fps.");
  const boundaries = [
    0,
    ...[...project.videoTracks, ...project.audioTracks].flatMap((t) =>
      t.clips.flatMap((c) => [c.start.seconds, c.start.seconds + c.duration.seconds]),
    ),
  ];
  for (const time of boundaries) {
    const issue = previewIssue(project, time);
    if (issue) throw new Error(issue);
  }
  const enabledAudio = enabledTracks(project, "audio").filter((t) =>
    t.clips.some((c) => c.enabled && !c.audio?.muted && !c.freezeFrame),
  );
  const w = project.settings.width,
    h = project.settings.height;
  const scale = Math.min(1, 1920 / Math.max(w, h), 1080 / Math.min(w, h));
  const frameCount = Math.ceil(duration * fps - 1e-7);
  return {
    duration: frameCount / fps,
    frameCount,
    fps,
    width: Math.max(2, Math.floor((w * scale) / 2) * 2),
    height: Math.max(2, Math.floor((h * scale) / 2) * 2),
    hasAudio: enabledAudio.length > 0,
  };
}

export interface LayerGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  radians: number;
}
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as ObjectValue) : {};
export function layerGeometry(
  clip: Clip,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): LayerGeometry {
  const transform = object(clip.video?.transform),
    position = object(transform.position);
  const scale = typeof transform.scale === "number" ? transform.scale : 1;
  const fit = Math.min(width / sourceWidth, height / sourceHeight) * Math.abs(scale);
  return {
    x: (typeof position.x === "number" ? position.x : 0.5) * width,
    y: (typeof position.y === "number" ? position.y : 0.5) * height,
    width: sourceWidth * fit,
    height: sourceHeight * fit,
    radians:
      ((typeof transform.rotation === "number" ? transform.rotation : 0) * Math.PI) / 180 +
      (scale < 0 ? Math.PI : 0),
  };
}
export function solidColor(clip: Clip): readonly [number, number, number, number] {
  const color = object(object(clip.content.solid).color);
  const result = [color.r ?? 0, color.g ?? 0, color.b ?? 0, color.a ?? 1];
  if (result.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1))
    throw new Error("Solid color components must be numbers from 0 to 1.");
  return result as [number, number, number, number];
}
function supportedPicture(clip: Clip): boolean {
  if (clip.content.media == null && clip.content.solid == null && clip.content.adjustment == null)
    return false;
  if (clip.content.solid != null) solidColor(clip);
  return Object.entries(clip.video ?? {}).every(([key, value]) => {
    if (value == null || key === "layoutPreset") return true;
    if (key === "transform") {
      const t = object(value),
        pos = object(t.position);
      return (
        Object.keys(t).every((k) => ["position", "scale", "rotation"].includes(k)) &&
        [t.scale ?? 1, t.rotation ?? 0, pos.x ?? 0.5, pos.y ?? 0.5].every(
          (v) => typeof v === "number" && Number.isFinite(v),
        ) &&
        Object.keys(pos).every((k) => ["x", "y"].includes(k))
      );
    }
    if (key === "opacity") return typeof value === "number" && Number.isFinite(value);
    if (key === "crop")
      return Object.entries(object(value)).every(
        ([k, v]) =>
          ["left", "top", "right", "bottom"].includes(k) &&
          typeof v === "number" &&
          Number.isFinite(v),
      );
    if (key === "effects")
      return Array.isArray(value) && effectIssue(value as unknown as ClipEffect[]) === null;
    if (key === "formatOverrides") return Object.keys(object(value)).length === 0;
    if (key === "cutout") return object(value).enabled === false;
    return false;
  });
}

export interface PictureLayer {
  clip: Clip;
  trackID: string;
  mediaID: string | null;
  sourceTime: number;
  color: readonly [number, number, number, number] | null;
}
export type PictureNode =
  | { kind: "layer"; layer: PictureLayer }
  | {
      kind: "transition";
      transition: Track["transitions"][number];
      start: number;
      end: number;
      from: PictureNode | null;
      to: PictureNode | null;
    };
const nodeLayers = (node: PictureNode): PictureLayer[] =>
  node.kind === "layer"
    ? [node.layer]
    : [...(node.from ? nodeLayers(node.from) : []), ...(node.to ? nodeLayers(node.to) : [])];
// Tracks are bottom to top; transition handles extend visibility around a centered cut.
export function framePlan(project: Project, time: number) {
  const nodes: PictureNode[] = [];
  for (const track of enabledTracks(project, "video")) {
    const windows = track.transitions
      .flatMap((transition) => {
        const window = transitionWindow(track, transition);
        return window ? [{ transition, ...window }] : [];
      })
      .sort((a, b) => a.start - b.start);
    const groups: { node: PictureNode; members: Set<string> }[] = [];
    for (const original of track.clips.filter((c) => c.enabled)) {
      let start = original.start.seconds,
        end = original.start.seconds + original.duration.seconds;
      for (const window of windows)
        if (window.transition.fromClipID != null && window.transition.toClipID != null) {
          if (window.transition.toClipID === original.id) start = Math.min(start, window.start);
          if (window.transition.fromClipID === original.id) end = Math.max(end, window.end);
        }
      if (time < start || time >= end) continue;
      const clip = resolveClip(original, time),
        reference = object(clip.content.media);
      groups.push({
        node: {
          kind: "layer",
          layer: {
            clip,
            trackID: track.id,
            mediaID: typeof reference.mediaID === "string" ? reference.mediaID : null,
            sourceTime: pictureTime(project, clip, time),
            color: clip.content.solid != null ? solidColor(clip) : null,
          },
        },
        members: new Set([clip.id]),
      });
    }
    for (const window of windows.filter((w) => time >= w.start && time < w.end)) {
      const from = groups.findIndex((g) => g.members.has(String(window.transition.fromClipID))),
        to = groups.findIndex((g) => g.members.has(String(window.transition.toClipID)));
      if ((from < 0 && to < 0) || (from >= 0 && from === to)) continue;
      const indices = [...new Set([from, to].filter((i) => i >= 0))],
        members = new Set(indices.flatMap((i) => [...groups[i]!.members]));
      const node: PictureNode = {
        kind: "transition",
        transition: window.transition,
        start: window.start,
        end: window.end,
        from: from >= 0 ? groups[from]!.node : null,
        to: to >= 0 ? groups[to]!.node : null,
      };
      const at = Math.min(...indices);
      for (const index of indices.sort((a, b) => b - a)) groups.splice(index, 1);
      groups.splice(at, 0, { node, members });
    }
    nodes.push(...groups.map((g) => g.node));
  }
  return {
    time,
    nodes,
    layers: nodes.flatMap(nodeLayers),
    audio: audioSegments(project)
      .filter((segment) => segment.start <= time && time < segment.end)
      .map((segment) => ({
        clip: segment.clip,
        trackID: segment.trackID,
        sourceTime: sourceTime(segment.clip, time),
        range: { from: sourceTime(segment.clip, time), to: segment.sourceEnd },
      })),
  };
}

export function sourceCrop(clip: Clip, width: number, height: number) {
  const crop = object(clip.video?.crop);
  const clamp = (v: unknown) => Math.max(0, Math.min(1, typeof v === "number" ? v : 0));
  const x = clamp(crop.left) * width,
    y = clamp(crop.top) * height;
  return {
    x,
    y,
    width: Math.max(0, (1 - clamp(crop.right)) * width - x),
    height: Math.max(0, (1 - clamp(crop.bottom)) * height - y),
  };
}
