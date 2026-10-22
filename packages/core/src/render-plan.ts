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
export function enabledTracks(project: Project, kind: "video" | "audio"): readonly Track[] {
  const tracks = kind === "video" ? project.videoTracks : project.audioTracks;
  const solo = tracks.some((track) => track.solo);
  return tracks.filter(
    (track) => !(kind === "video" ? track.hidden : track.muted) && (!solo || track.solo),
  );
}
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
    clip.sourceStart.seconds +
    (clip.freezeFrame ? 0 : Math.max(0, time - clip.start.seconds) * clip.speed)
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
  const video = activeClips(project, time, "video");
  const audio = activeClips(project, time, "audio");
  if (audio.length > 1)
    return "Preview currently supports one audio source at a time. Audio mixing is planned.";
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
    if (
      track.transitions.length ||
      (track.kind === "audio" && Boolean(clip.keyframes["audio.gainDB"]?.length)) ||
      (track.kind === "video"
        ? !supportedPicture(resolveClip(clip, time))
        : clip.content.media == null) ||
      (clip.audio &&
        Object.entries(clip.audio).some(
          ([key, value]) =>
            !(
              (["muted"].includes(key) && value === false) ||
              (["gainDB", "pan", "fadeIn", "fadeOut", "voiceIsolation"].includes(key) &&
                value === 0) ||
              (key === "effects" && Array.isArray(value) && value.length === 0) ||
              (key === "normalizeTo" && value === null)
            ),
        )) ||
      (track.kind === "audio" && clip.speed !== 1)
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
  if (enabledAudio.length > 1)
    throw new Error(
      "The browser exporter supports one audio track. Move sound onto one track before exporting.",
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
  if (clip.content.media == null && clip.content.solid == null) return false;
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

// Tracks are stored bottom to top. Half-open clip intervals choose the right clip at a cut.
export function framePlan(project: Project, time: number) {
  return {
    time,
    layers: activeClips(project, time, "video").map(({ clip: original, track }) => {
      const clip = resolveClip(original, time);
      const reference = object(clip.content.media);
      return {
        clip,
        trackID: track.id,
        mediaID: typeof reference.mediaID === "string" ? reference.mediaID : null,
        sourceTime: pictureTime(project, clip, time),
        color: clip.content.solid != null ? solidColor(clip) : null,
      };
    }),
    audio: activeClips(project, time, "audio").map(({ clip, track }) => ({
      clip,
      trackID: track.id,
      sourceTime: sourceTime(clip, time),
      range: audioRange(project, clip, time),
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
