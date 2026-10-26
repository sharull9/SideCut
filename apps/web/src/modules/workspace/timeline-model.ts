import type { Project } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";

export { projectDuration, activeClips, previewIssue, sourceTime } from "@sidecut/core/render-plan";
import { projectDuration } from "@sidecut/core/render-plan";
export function atFrame(seconds: number, project: Project): Time {
  return Time.fromSeconds(Math.max(0, seconds)).roundedToFrame(project.settings.frameRate);
}

/** Snap either moving edge within six screen pixels, excluding the dragged clips. */
export function snapEdit(
  seconds: number,
  project: Project,
  zoom: number,
  exclude: readonly string[],
  playhead: number,
  duration = 0,
): Time {
  let nearest = seconds,
    distance = 6 / zoom;
  const consider = (target: number) => {
    for (const candidate of [target, target - duration]) {
      const next = Math.abs(candidate - seconds);
      if (candidate >= 0 && next <= distance) {
        nearest = candidate;
        distance = next;
      }
    }
  };
  consider(0);
  consider(playhead);
  for (const marker of project.markers) consider(marker.time);
  for (const track of [...project.videoTracks, ...project.audioTracks])
    for (const clip of track.clips) {
      if (exclude.includes(clip.id)) continue;
      consider(clip.start.seconds);
      consider(clip.start.seconds + clip.duration.seconds);
    }
  return atFrame(nearest, project);
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
