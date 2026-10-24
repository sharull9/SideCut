import { ProjectCoordinator, type JournalEntry } from "./coordinator";
import {
  decodeProjectFile,
  encodeProjectFile,
  type ProjectFile,
  type ProjectFileSchema,
} from "@sidecut/contracts/project";
import { queryClips, queryTracks, QueryError } from "./project-queries";
import { object as requiredObject } from "./import-builder";
import { projectDuration } from "./render-plan";
import { changeContent, changeDetails, sameClip, near, queryClock } from "./clip-change-details";
import { namesFor as mediaNames } from "./timeline-dump";

const object = (value: unknown) => (value == null ? {} : requiredObject(value));

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
  const rows = (file: ProjectFile) =>
    new Map(
      queryTracks(file.project).flatMap(({ track, label }, order) =>
        track.clips.map((clip) => [clip.id, { clip, track, label, order }] as const),
      ),
    );
  const old = rows(before),
    now = rows(after),
    names = mediaNames(after.project);
  for (const [id, name] of mediaNames(before.project)) if (!names.has(id)) names.set(id, name);
  const raw = (file: ProjectFile) => {
    const encoded = wireFile(file).project;
    return new Map(
      [...(encoded.videoTracks ?? []), ...(encoded.audioTracks ?? [])]
        .flatMap((t) => t.clips ?? [])
        .map((c) => [c.id, c]),
    );
  };
  const rawBefore = raw(before),
    rawAfter = raw(after);
  const changes = [...new Set([...now.keys(), ...old.keys()])].flatMap((id) => {
    const a = old.get(id),
      b = now.get(id);
    if (a && b && a.track.id === b.track.id && sameClip(a.clip, b.clip)) return [];
    const item = b ?? a!;
    const movedTrack = !!a && !!b && a.track.id !== b.track.id;
    const moved =
      a &&
      b &&
      (movedTrack ||
        !near(a.clip.start.seconds, b.clip.start.seconds) ||
        !near(
          a.clip.start.add(a.clip.duration).seconds,
          b.clip.start.add(b.clip.duration).seconds,
        ));
    return [
      {
        id,
        kind: a ? (b ? "changed" : "removed") : "added",
        track: item.label,
        trackID: item.track.id,
        start: item.clip.start.seconds,
        end: item.clip.start.add(item.clip.duration).seconds,
        content: changeContent(item.clip, names),
        ...(a && b
          ? changeDetails(a.clip, b.clip, a.label, b.label, movedTrack, names)
          : { details: [] }),
        ...(moved
          ? {
              wasStart: a!.clip.start.seconds,
              wasEnd: a!.clip.start.add(a!.clip.duration).seconds,
              ...(movedTrack ? { wasTrack: a!.label } : {}),
            }
          : {}),
        ...(a ? { before: rawBefore.get(id)! } : {}),
        ...(b ? { after: rawAfter.get(id)! } : {}),
      },
    ];
  });
  for (const added of changes.filter((c) => c.kind === "added")) {
    const piece = now.get(added.id)?.clip;
    if (!piece) continue;
    const mediaID = object(piece.content.media).mediaID;
    if (!mediaID) continue;
    const left = changes.find((c) => {
      const a = old.get(c.id)?.clip,
        b = now.get(c.id)?.clip;
      return (
        c.kind === "changed" &&
        c.trackID === added.trackID &&
        a &&
        b &&
        object(a.content.media).mediaID === mediaID &&
        object(b.content.media).mediaID === mediaID &&
        b.duration.flicks < a.duration.flicks &&
        near(b.start.seconds, a.start.seconds) &&
        piece.start.seconds >= c.end - 0.0005 &&
        a.speed === piece.speed &&
        piece.sourceStart.seconds >=
          b.sourceStart.seconds + b.duration.seconds * b.speed - 0.0005 &&
        piece.sourceStart.seconds + piece.duration.seconds * piece.speed <=
          a.sourceStart.seconds + a.duration.seconds * a.speed + 0.0005
      );
    });
    if (left) {
      added.details = [`the rest of ${left.id} after a cut`];
      left.details = left.details.map((d) =>
        d.startsWith("end ") ? `cut at ${queryClock(left.end)}, the rest is ${added.id}` : d,
      );
    }
  }
  const order = (c: (typeof changes)[number]) => (now.get(c.id) ?? old.get(c.id))!.order;
  return changes.sort(
    (a, b) => a.start - b.start || order(a) - order(b) || a.id.localeCompare(b.id),
  );
}
export function diffEdits(file: ProjectFile, since: number) {
  const journal = file.sidecutJournal as { base: string; entries: JournalEntry[] } | undefined;
  if (!journal) return file.revision === since ? [] : undefined;
  const replay = new ProjectCoordinator(decodeProjectFile(JSON.parse(journal.base)));
  if (replay.getSnapshot().revision > since) return undefined;
  return journal.entries.flatMap((entry) => {
    const before = replay.projectFile();
    if (entry.kind === "edit") replay.apply(entry.batch);
    else replay[entry.kind]();
    if (entry.result.revision <= since) return [];
    const changes = clipChanges(before, replay.projectFile()),
      place = diffPlace(changes);
    return [
      {
        revision: entry.result.revision,
        kind: entry.kind,
        label: entry.result.label,
        author: entry.result.author,
        ...(entry.date ? { date: entry.date } : {}),
        ...place,
        changes,
      },
    ];
  });
}
function diffPlace(changes: ReturnType<typeof clipChanges>) {
  const core = changes.filter((c) => c.shift == null),
    used = core.length ? core : changes;
  if (!used.length) return {};
  const cuts = new Map<string, number>();
  for (const added of used.filter((c) => c.kind === "added")) {
    const left = used.find(
      (c) =>
        c.kind === "changed" &&
        c.trackID === added.trackID &&
        c.wasEnd != null &&
        near(c.wasEnd, added.end) &&
        near(c.end, added.start),
    );
    if (left) {
      cuts.set(left.id, left.end);
      cuts.set(added.id, added.start);
    }
  }
  const ranges = used.map((c) => {
    const cut = cuts.get(c.id);
    if (cut != null) return [cut, cut];
    const a = c.before,
      b = c.after;
    if (
      a &&
      b &&
      (a.speed ?? 1) === (b.speed ?? 1) &&
      !b.freezeFrame &&
      near(Number(a.start ?? 0), Number(b.start ?? 0))
    ) {
      const source = Number(b.sourceStart ?? 0) - Number(a.sourceStart ?? 0),
        trim = source / Number(b.speed ?? 1);
      if (!near(source) && near(c.end - (c.wasEnd ?? c.end), -trim))
        return [Number(a.start ?? 0), Number(a.start ?? 0) + trim];
    }
    if (c.kind !== "changed" || c.wasStart == null || c.wasEnd == null) return [c.start, c.end];
    if (c.wasTrack != null || c.shift != null || near(c.start - c.wasStart, c.end - c.wasEnd))
      return [Math.min(c.start, c.wasStart), Math.max(c.end, c.wasEnd)];
    const edges = [
      ...(!near(c.start, c.wasStart) ? [c.start, c.wasStart] : []),
      ...(!near(c.end, c.wasEnd) ? [c.end, c.wasEnd] : []),
    ];
    return edges.length ? [Math.min(...edges), Math.max(...edges)] : [c.start, c.end];
  });
  const tracks = [
    ...new Set(used.flatMap((c) => (c.wasTrack ? [c.track, c.wasTrack] : [c.track]))),
  ];
  const rank = (label: string) => {
    const index = Number(label.split(" ")[0]!.slice(1));
    return label.startsWith("V") ? -index : 10000 + index;
  };
  return {
    start: Math.min(...ranges.map((r) => r[0]!)),
    end: Math.max(...ranges.map((r) => r[1]!)),
    tracks: tracks.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
  };
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
  const wanted = String(request.track ?? "").toLowerCase();
  const selectedTrack = queryTracks(current.project).find(
    ({ track, label }) =>
      track.id === request.track ||
      track.name.toLowerCase() === wanted ||
      label.toLowerCase() === wanted ||
      label.split(" ")[0]!.toLowerCase() === wanted,
  );
  if (request.track != null && !selectedTrack)
    throw new QueryError("notFound", `There is no track "${String(request.track)}".`);
  const trackID = request.track == null ? undefined : selectedTrack?.track.id;
  const selection = (file: ProjectFile) =>
    queryClips(file, {
      ...(request.fromTime == null ? {} : { from: request.fromTime }),
      ...(request.toTime == null ? {} : { to: request.toTime }),
    }).clips.filter((c) => trackID == null || c.trackID === trackID);
  const oldIDs = new Set(queryClips(source, {}).clips.map((c) => c.id));
  const ids = new Set(
    supplied ??
      [...selection(source), ...selection(current).filter((c) => !oldIDs.has(c.id))]
        .map((c) => c.id)
        .sort(),
  );
  const old = queryClips(source, {}).clips,
    now = queryClips(current, {}).clips,
    commands: unknown[] = [],
    items: {
      id: string;
      action: string;
      track: string;
      start: number;
      end: number;
      content: string;
      details: string[];
    }[] = [];
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
      content: changeContent(
        queryTracks((a ? source : current).project)
          .flatMap(({ track }) => track.clips)
          .find((c) => c.id === id)!,
        mediaNames((a ? source : current).project),
      ),
      details: change ? (clipChanges(current, source).find((c) => c.id === id)?.details ?? []) : [],
    });
    if (!change) continue;
    if (a && b && a.trackID === b.trackID) {
      const patch = mergeDiff(currentClips.get(id)!, sourceClips.get(id)!);
      delete patch["id"];
      patches.set(id, patch);
      continue;
    }
    if (b) commands.push({ removeClips: { clipIDs: [id], ripple: false, includeLinked: false } });
  }
  const media = new Set(current.project.media.map((m) => m.id));
  for (const id of ids) {
    const a = old.find((c) => c.id === id);
    if (!a || !clipChanges(source, current).some((c) => c.id === id)) continue;
    const sourceTrack = queryTracks(source.project).find((t) => t.track.id === a.trackID)!.track;
    const target =
      tracks.find((t) => t.track.id === a.trackID) ??
      tracks.find(
        (t) =>
          t.track.kind === sourceTrack.kind &&
          t.track.name.toLowerCase() === sourceTrack.name.toLowerCase(),
      );
    if (!target) throw new QueryError("notFound", "Restore requires the original track to exist.");
    const item = items.find((candidate) => candidate.id === id)!;
    item.track = target.label;
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
        : { insertClip: { trackID: target.track.id, clip } },
    );
  }
  items.sort(
    (a, b) =>
      tracks.findIndex((t) => t.label === a.track) - tracks.findIndex((t) => t.label === b.track) ||
      a.start - b.start ||
      a.id.localeCompare(b.id),
  );
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
