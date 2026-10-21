import type { Project } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";

export { projectDuration, activeClips, previewIssue, sourceTime } from "@sidecut/core/render-plan";
import { projectDuration } from "@sidecut/core/render-plan";
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
