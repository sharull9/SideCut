import { ProjectCoordinator, type JournalEntry } from "./coordinator";
import {
  decodeProjectFile,
  encodeProjectFile,
  type ProjectFile,
  type ProjectFileSchema,
} from "@sidecut/contracts/project";
import { queryClips, queryTracks, QueryError } from "./project-queries";
import { projectDuration } from "./render-plan";

export const wireFile = (file: ProjectFile): typeof ProjectFileSchema.Encoded =>
  JSON.parse(encodeProjectFile(file));
export function revisionFile(file: ProjectFile, revision: number): ProjectFile {
  if (file.revision === revision) return file;
  const journal = file.sidecutJournal as { base: string; entries: JournalEntry[] } | undefined;
  if (!journal)
    throw new QueryError("notFound", `Revision ${revision} is not available.`, file.revision);
  let current = decodeProjectFile(JSON.parse(journal.base));
  if (current.revision === revision) return current;
  for (const entry of journal.entries) {
    if (entry.kind === "edit") {
      const replay = new ProjectCoordinator(current);
      replay.apply(entry.batch);
      current = replay.projectFile();
    } else current = decodeProjectFile(JSON.parse(entry.snapshot!));
    if (current.revision === revision) return current;
  }
  throw new QueryError("notFound", `Revision ${revision} is not available.`, file.revision);
}
export function clipChanges(before: ProjectFile, after: ProjectFile) {
  const old = queryClips(before, {}).clips,
    now = queryClips(after, {}).clips;
  const raw = (file: ProjectFile) => {
    const encoded = wireFile({ revision: file.revision, project: file.project }).project;
    return new Map(
      [...(encoded.videoTracks ?? []), ...(encoded.audioTracks ?? [])]
        .flatMap((track) => track.clips ?? [])
        .map((clip) => [clip.id, clip]),
    );
  };
  const beforeClips = raw(before),
    afterClips = raw(after);
  return [...new Set([...now.map((c) => c.id), ...old.map((c) => c.id)])]
    .flatMap((id) => {
      const a = old.find((c) => c.id === id),
        b = now.find((c) => c.id === id),
        first = beforeClips.get(id),
        last = afterClips.get(id);
      if (a && b && JSON.stringify(first) === JSON.stringify(last) && a.trackID === b.trackID)
        return [];
      const item = b ?? a!;
      const details =
        a && b
          ? [...new Set([...Object.keys(first ?? {}), ...Object.keys(last ?? {})])]
              .filter((key) => JSON.stringify(first?.[key]) !== JSON.stringify(last?.[key]))
              .map((key) => `${key} changed`)
          : [];
      return [
        {
          id,
          kind: a ? (b ? "changed" : "removed") : "added",
          track: item.track,
          trackID: item.trackID,
          start: item.start,
          end: item.end,
          content: item.content,
          details,
          ...(a && b ? { wasTrack: a.track, wasStart: a.start, wasEnd: a.end } : {}),
          ...(first ? { before: first } : {}),
          ...(last ? { after: last } : {}),
        },
      ];
    })
    .sort((a, b) => a.start - b.start || a.track.localeCompare(b.track));
}
export function editOutcome(
  before: ProjectFile,
  after: ProjectFile,
  result: {
    revision: number;
    label: string;
    author: string;
    createdIDs: readonly string[];
    warnings: readonly string[];
  },
  dryRun = false,
  repeated = false,
) {
  const changes = clipChanges(before, after);
  return {
    ...result,
    revision: dryRun ? before.revision : result.revision,
    dryRun,
    repeated,
    added: changes.filter((c) => c.kind === "added").map((c) => c.id),
    removed: changes.filter((c) => c.kind === "removed").map((c) => c.id),
    changed: changes.filter((c) => c.kind === "changed").map((c) => c.id),
    duration: projectDuration(after.project).seconds,
  };
}
export function restorePlan(
  current: ProjectFile,
  source: ProjectFile,
  request: Record<string, unknown>,
) {
  const hasRange = request.fromTime != null || request.toTime != null;
  const supplied = request.clips as string[] | undefined;
  if ((!supplied?.length && !hasRange) || (supplied && hasRange))
    throw new QueryError("badRequest", "Give clips or fromTime/toTime to restore.");
  const selection = (file: ProjectFile) =>
    queryClips(file, {
      ...(request.track ? { track: request.track } : {}),
      ...(request.fromTime == null ? {} : { from: request.fromTime }),
      ...(request.toTime == null ? {} : { to: request.toTime }),
    }).clips;
  const ids = new Set(supplied ?? [...selection(source), ...selection(current)].map((c) => c.id));
  const old = queryClips(source, {}).clips,
    now = queryClips(current, {}).clips,
    commands: unknown[] = [],
    items: unknown[] = [];
  const tracks = queryTracks(current.project);
  const patches = new Map<string, unknown>();
  const encodedSource = wireFile(source).project,
    encodedCurrent = wireFile(current).project;
  const sourceClips = new Map(
    [...(encodedSource.videoTracks ?? []), ...(encodedSource.audioTracks ?? [])]
      .flatMap((track) => track.clips ?? [])
      .map((clip) => [clip.id, clip]),
  );
  const currentClips = new Map(
    [...(encodedCurrent.videoTracks ?? []), ...(encodedCurrent.audioTracks ?? [])]
      .flatMap((track) => track.clips ?? [])
      .map((clip) => [clip.id, clip]),
  );
  const mergeDiff = (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Record<string, unknown> =>
    Object.fromEntries(
      [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => {
        const value = after[key],
          previous = before[key];
        return [
          key,
          value && typeof value === "object" && !Array.isArray(value)
            ? mergeDiff(
                previous && typeof previous === "object" && !Array.isArray(previous)
                  ? (previous as Record<string, unknown>)
                  : {},
                value as Record<string, unknown>,
              )
            : (value ?? null),
        ];
      }),
    );
  for (const id of ids) {
    const a = old.find((c) => c.id === id),
      b = now.find((c) => c.id === id);
    if (!a && !b) throw new QueryError("notFound", `Clip ${id} does not exist in either revision.`);
    const change = clipChanges(source, current).find((c) => c.id === id),
      placed = a ?? b!;
    items.push({
      id,
      action: !change ? "unchanged" : !a ? "remove" : !b ? "putBack" : "changeBack",
      track: placed.track,
      start: placed.start,
      end: placed.end,
      content: placed.content,
      details: change?.details ?? [],
    });
    if (!change) continue;
    if (a && b && a.trackID === b.trackID && a.start === b.start && a.end === b.end) {
      const patch = mergeDiff(currentClips.get(id)!, sourceClips.get(id)!);
      delete patch["id"];
      patches.set(id, patch);
      continue;
    }
    if (
      [
        ...current.project.videoTracks,
        ...current.project.audioTracks,
        ...source.project.videoTracks,
        ...source.project.audioTracks,
      ].some((track) =>
        track.transitions.some(
          (transition) => transition.fromClipID === id || transition.toClipID === id,
        ),
      )
    )
      throw new QueryError(
        "notImplemented",
        "Restore of moved or removed clips with transitions requires transition-aware restoration.",
      );
    if (b) commands.push({ removeClips: { clipIDs: [id], ripple: false, includeLinked: false } });
  }
  const media = new Set(current.project.media.map((m) => m.id));
  for (const id of ids) {
    const a = old.find((c) => c.id === id);
    if (!a || !clipChanges(source, current).some((c) => c.id === id)) continue;
    if (!tracks.some(({ track }) => track.id === a.trackID))
      throw new QueryError("unavailable", "Restore requires the original track to exist.");
    if (a.mediaID && !media.has(a.mediaID)) {
      commands.push({
        addMedia: { item: wireFile(source).project.media?.find((m) => m.id === a.mediaID) },
      });
      media.add(a.mediaID);
    }
    const clip = [
      ...(wireFile(source).project.videoTracks ?? []),
      ...(wireFile(source).project.audioTracks ?? []),
    ]
      .flatMap((t) => t.clips ?? [])
      .find((c) => c.id === id);
    commands.push(
      patches.has(id)
        ? { updateClip: { clipID: id, patch: patches.get(id) } }
        : { insertClip: { trackID: a.trackID, clip } },
    );
  }
  let problem: string | undefined;
  try {
    if (commands.length) new ProjectCoordinator(current).apply({ commands });
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  return {
    revision: current.revision,
    from: `revision ${source.revision}`,
    items,
    commands,
    ...(problem ? { problem } : {}),
  };
}
