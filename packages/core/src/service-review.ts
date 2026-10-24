import type { ProjectFile } from "@sidecut/contracts/project";
import { markerKind } from "@sidecut/contracts/project";
import { queryClips } from "./project-queries";
import { modelProblems, checkRanges } from "./quality-check";
import type { Range } from "./speech";
import { speechMap, type Transcripts } from "./speech";
import { validateProject } from "./validation";

export function reviewQuery(
  file: ProjectFile,
  operation: string,
  request: Record<string, unknown>,
  changed?: Range[],
  transcripts: Transcripts = () => undefined,
) {
  const issues = validateProject(file.project);
  if (operation === "validate")
    return {
      revision: file.revision,
      ok: !issues.some((i) => i.severity === "error"),
      valid: !issues.some((i) => i.severity === "error"),
      issues,
    };
  const clips = queryClips(file, {}).clips;
  if (operation === "comments") {
    const words = speechMap(file.project, transcripts).words;
    return {
      revision: file.revision,
      comments: file.project.markers
        .filter((m) => markerKind(m) === "comment")
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          id: m.id,
          time: m.time,
          text: m.name,
          ...(() => {
            const near = words.filter((w) => w.end > m.time - 4 && w.start < m.time + 4);
            return near.length
              ? {
                  said: [
                    ...near.filter((w) => w.start < m.time).map((w) => w.text),
                    "|",
                    ...near.filter((w) => w.start >= m.time).map((w) => w.text),
                  ].join(" "),
                }
              : {};
          })(),
          clips: clips
            .filter((c) => c.start <= m.time && c.end > m.time)
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
  }
  const ranges = checkRanges(file.project, request, changed);
  const found = modelProblems(file.project, ranges),
    notes = found.filter((p) => ["soft", "sliver"].includes(p.kind)),
    problems = found.filter((p) => !["soft", "sliver"].includes(p.kind));
  return {
    revision: file.revision,
    ok: problems.length === 0,
    ranges: ranges.map((r) => ({ start: r.start, duration: r.end - r.start })),
    frames: 0,
    seconds: 0,
    problems,
    notes,
    clipNames: Object.fromEntries(clips.map((c) => [c.id, c.name ?? c.content])),
    commands: [],
    warnings: [],
    ...(!ranges.length
      ? { note: "Nothing is waiting for review, so there was nothing to check." }
      : {}),
  };
}
