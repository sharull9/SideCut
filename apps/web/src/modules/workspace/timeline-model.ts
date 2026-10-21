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

export function atFrame(seconds: number, project: Project): Time {
  return Time.fromSeconds(Math.max(0, seconds)).roundedToFrame(project.settings.frameRate);
}

export function stepFrame(time: Time, delta: number, project: Project): Time {
  const frame =
    time.roundedToFrame(project.settings.frameRate).frameIndex(project.settings.frameRate) +
    BigInt(delta);
  const result = Time.frames(frame < 0n ? 0n : frame, project.settings.frameRate);
  const end = projectDuration(project);
  return result.flicks > end.flicks ? end : result;
}

export function timecode(time: Time, project: Project): string {
  const rate = project.settings.frameRate;
  const frames = time.frameIndex(rate);
  const nominal = BigInt(Math.round(rate.numerator / rate.denominator));
  if (nominal < 1n) return `${time.seconds.toFixed(3)} s`;
  const parts = [
    frames / (nominal * 3600n),
    (frames / (nominal * 60n)) % 60n,
    (frames / nominal) % 60n,
    frames % nominal,
  ];
  return parts.map((value) => String(value).padStart(2, "0")).join(":");
}

export interface ActiveClip {
  clip: Clip;
  track: Track;
}
export function activeClips(project: Project, time: number, kind: "video" | "audio"): ActiveClip[] {
  const tracks = kind === "video" ? project.videoTracks : project.audioTracks;
  const solo = tracks.some((track) => track.solo);
  return tracks
    .filter((track) => !(kind === "video" ? track.hidden : track.muted) && (!solo || track.solo))
    .flatMap((track) =>
      track.clips
        .filter(
          (clip) =>
            clip.enabled &&
            clip.start.seconds <= time &&
            time < clip.start.seconds + clip.duration.seconds &&
            !(kind === "audio" && clip.audio?.muted === true),
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
        Object.entries(clip.audio).some(([key, value]) => key !== "muted" || value !== false)) ||
      clip.speed !== 1 ||
      clip.freezeFrame ||
      clip.holdEdges
    )
      return "This clip needs rendering features that are not available in the source preview yet.";
  }
  return null;
}
