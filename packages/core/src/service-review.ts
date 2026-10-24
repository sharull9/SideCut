import type { ProjectFile } from "@sidecut/contracts/project";
import { markerKind } from "@sidecut/contracts/project";
import { queryClips, QueryError } from "./project-queries";
import { validateProject } from "./validation";

export function reviewQuery(
  file: ProjectFile,
  operation: string,
  request: Record<string, unknown>,
) {
  const issues = validateProject(file.project);
  if (operation === "validate")
    return { revision: file.revision, valid: !issues.some((i) => i.severity === "error"), issues };
  const clips = queryClips(file, {}).clips;
  if (operation === "comments")
    return {
      revision: file.revision,
      comments: file.project.markers
        .filter((m) => markerKind(m) === "comment")
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          id: m.id,
          time: m.time,
          text: m.name,
          clips: clips
            .filter((c) => c.enabled && c.start <= m.time && c.end > m.time)
            .reverse()
            .map((c) => ({
              track: c.track,
              trackID: c.trackID,
              clipID: c.id,
              start: c.start,
              end: c.end,
              content: c.content,
            })),
        })),
    };
  if (request.quick !== true || request.cuts === true || request.changed === true)
    throw new QueryError(
      "notImplemented",
      "Only quick structural checks are available. Rendered scans, speech-cut checks and reviewed-range checks are pending.",
    );
  const duration = Math.max(0, ...clips.map((c) => c.end)),
    from = Number(request.from ?? 0),
    to = Number(request.to ?? duration);
  const notes: { kind: string; time: number; duration: number; clipID: string; message: string }[] =
    [];
  const fps =
    file.project.settings.frameRate.numerator / file.project.settings.frameRate.denominator;
  for (const track of [...file.project.videoTracks, ...file.project.audioTracks]) {
    const ordered = track.clips
      .filter((c) => c.enabled)
      .toSorted((a, b) => a.start.seconds - b.start.seconds);
    let end = from;
    for (const clip of ordered) {
      const start = clip.start.seconds,
        stop = start + clip.duration.seconds;
      if (stop <= from || start >= to) continue;
      if (start > end && start - end < 1 / fps)
        notes.push({
          kind: "sliverGap",
          time: end,
          duration: start - end,
          clipID: clip.id,
          message: "Gap shorter than one frame.",
        });
      if (clip.duration.seconds < 1 / fps)
        notes.push({
          kind: "sliverClip",
          time: start,
          duration: clip.duration.seconds,
          clipID: clip.id,
          message: "Clip shorter than one frame.",
        });
      end = Math.max(end, stop);
    }
  }
  const problems = issues.filter((i) => i.severity === "error");
  return {
    revision: file.revision,
    ok: problems.length === 0,
    ranges: to > from ? [{ start: from, duration: to - from }] : [],
    frames: 0,
    seconds: 0,
    problems,
    notes,
    clipNames: Object.fromEntries(clips.map((c) => [c.id, c.name ?? c.content])),
    commands: [],
    warnings: [
      "Structural validation and subframe clips/gaps only; black frames, softness and speech cuts were not scanned.",
      ...issues.filter((i) => i.severity === "warning").map((i) => i.message),
    ],
  };
}
