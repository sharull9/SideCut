// Adapted from TandemAPI/Sync.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project, MediaItem, ProjectFile } from "@sidecut/contracts/project";
import { clipMediaID, QueryError } from "./project-queries";
import { ProjectCoordinator } from "./coordinator";
import type { SoundMatch } from "./sound-sync";

export function resolveServiceMedia(project: Project, refs: readonly string[]) {
  const clips = [...project.videoTracks, ...project.audioTracks].flatMap((t) => t.clips);
  return [
    ...new Set(
      refs.map((ref) => {
        const clip = clips.find((c) => c.id === ref);
        const exact = project.media.find(
          (m) => m.id === ref || (clip && m.id === clipMediaID(clip)),
        );
        if (exact) return exact;
        const path = ref.replaceAll("\\", "/").toLowerCase();
        const matches = project.media.filter((m) => {
          const own = m.path.replaceAll("\\", "/").toLowerCase();
          return own === path || own.endsWith(`/${path}`);
        });
        if (matches.length !== 1)
          throw new QueryError(
            matches.length ? "badRequest" : "notFound",
            `Media reference is ${matches.length ? "ambiguous" : "missing"}: ${ref}.`,
          );
        return matches[0]!;
      }),
    ),
  ];
}
export const isCameraTake = (m: MediaItem) =>
  m.role === "camera" && m.kind === "video" && m.hasVideo;
export function soundTargets(file: ProjectFile, request: Record<string, unknown>) {
  if (request.delay != null || request.media != null || request.makeDefault != null)
    throw new QueryError("badRequest", "Give either a picture delay or files to align by sound.");
  const items = resolveServiceMedia(file.project, request.files as string[]);
  if (!items.length) throw new QueryError("badRequest", "Name files to align by sound.");
  const clips = [...file.project.videoTracks, ...file.project.audioTracks].flatMap((t) => t.clips);
  const cameras = file.project.media.filter((m) => isCameraTake(m) && !items.includes(m));
  const placed = cameras.filter((m) => clips.some((c) => clipMediaID(c) === m.id));
  const choices =
    request.to == null
      ? placed.length
        ? placed
        : cameras
      : resolveServiceMedia(file.project, [String(request.to)]);
  if (choices.length !== 1)
    throw new QueryError(
      "badRequest",
      "Choose a reference recording with to; no unique camera take was found.",
    );
  const reference = choices[0]!;
  if (items.includes(reference))
    throw new QueryError("badRequest", "A recording cannot align with itself.");
  if ([reference, ...items].some((m) => !m.hasAudio || m.kind === "image"))
    throw new QueryError("badRequest", "Every sync source must have sound.");
  return { items, reference };
}
export function soundSyncPlan(
  file: ProjectFile,
  reference: MediaItem,
  measured: { item: MediaItem; match: SoundMatch }[],
  place = true,
) {
  const takeID =
    reference.takeID ??
    `take_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const cameraOffset = reference.takeID ? (reference.takeOffset?.seconds ?? 0) : 0;
  const offsets = new Map(
    file.project.media
      .filter((m) => m.takeID === takeID)
      .map((m) => [m.id, m.takeOffset?.seconds ?? 0]),
  );
  offsets.set(reference.id, cameraOffset);
  for (const { item, match } of measured) offsets.set(item.id, cameraOffset - match.offset);
  const shift = Math.max(0, -Math.min(...offsets.values()));
  const commands: unknown[] = [];
  for (const item of file.project.media) {
    const offset = offsets.get(item.id);
    if (offset == null) continue;
    const voice =
      measured.some((m) => m.item.id === item.id) &&
      !item.hasVideo &&
      ["music", "sfx"].includes(item.role);
    if (item.takeID !== takeID || item.takeOffset?.seconds !== offset + shift || voice)
      commands.push({
        updateMedia: {
          mediaID: item.id,
          patch: { takeID, takeOffset: offset + shift, ...(voice ? { role: "other" } : {}) },
        },
      });
  }
  const tracks = [...file.project.videoTracks, ...file.project.audioTracks];
  const matches = measured.map(({ item, match }) => ({
    id: item.id,
    path: item.path,
    ...match,
    takeID,
    takeOffset: offsets.get(item.id)! + shift,
    notes:
      place && tracks.some((t) => t.clips.some((c) => clipMediaID(c) === item.id))
        ? ["It was on the timeline already; its clips were left where they were."]
        : [],
  }));
  if (place)
    for (const { item } of measured.toSorted(
      (a, b) =>
        a.match.overlapEnd - a.match.overlapStart - (b.match.overlapEnd - b.match.overlapStart),
    )) {
      if (!tracks.some((t) => t.clips.some((c) => clipMediaID(c) === item.id)))
        commands.push({ placeSynced: { mediaID: item.id } });
    }
  if (commands.length) new ProjectCoordinator(file).apply({ label: "Sync by sound", commands });
  return { commands, matches, reference: reference.path };
}
