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
  if (video.length > 1 || audio.length > 1)
    return "Preview currently supports one picture and one audio source at a time. Compositing and audio mixing are planned.";
  for (const { clip, track } of [...video, ...audio]) {
    const reference = clip.content.media;
    const mediaID =
      reference && typeof reference === "object" && "mediaID" in reference
        ? reference.mediaID
        : null;
    if (
      track.transitions.length ||
      project.media.some((item) => item.id === mediaID && item.look.length > 0) ||
      Object.keys(clip.keyframes).length ||
      clip.content.media == null ||
      (clip.video && Object.keys(clip.video).length) ||
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
      return "This clip needs rendering features that are not available in the source preview yet. Audio speed changes need pitch correction; speech levelling needs source analysis.";
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
  const enabledVideos = enabledTracks(project, "video").filter((t) =>
      t.clips.some((c) => c.enabled),
    ),
    enabledAudio = enabledTracks(project, "audio").filter((t) =>
      t.clips.some((c) => c.enabled && !c.audio?.muted && !c.freezeFrame),
    );
  if (enabledVideos.length > 1 || enabledAudio.length > 1)
    throw new Error(
      "The first exporter supports one picture track and one audio track. Move sources onto those tracks before exporting.",
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
