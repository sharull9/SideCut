// TandemAPI ServiceTypes.swift, Diff.swift and TimelineDump.swift at 735a9b8.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, Project, ProjectFile } from "@sidecut/contracts/project";
import { encodeProjectFile } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { object } from "./interchange";

export class QueryError extends Error {
  constructor(
    readonly code:
      | "badRequest"
      | "notFound"
      | "unavailable"
      | "nothingToUndo"
      | "nothingToRedo"
      | "notImplemented",
    message: string,
    readonly revision?: number,
  ) {
    super(message);
  }
}
export function queryRequest(operation: string, input: unknown) {
  const request = object(input);
  const fields: Record<string, Record<string, string>> = {
    status: {},
    media: { refresh: "boolean" },
    timeline: { from: "time", to: "time", format: "string", words: "boolean", summary: "boolean" },
    clips: { track: "string", from: "time", to: "time", media: "string", ids: "boolean" },
  };
  const accepted = Object.hasOwn(fields, operation) ? fields[operation] : undefined;
  if (!accepted) throw new QueryError("notFound", `Unknown project query: ${operation}.`);
  for (const [key, value] of Object.entries(request)) {
    const type = Object.hasOwn(accepted, key) ? accepted[key] : undefined;
    if (!type) throw new QueryError("badRequest", `Unknown ${operation} field: ${key}.`);
    if (value == null) continue;
    if (type === "time") parseQueryTime(value);
    else if (typeof value !== type) throw new QueryError("badRequest", `Invalid ${key}.`);
  }
  if (request.format != null && !["text", "json"].includes(String(request.format)))
    throw new QueryError("badRequest", "format must be text or json.");
  const from = request.from == null ? null : parseQueryTime(request.from),
    to = request.to == null ? null : parseQueryTime(request.to);
  if (from !== null && to !== null && to <= from)
    throw new QueryError("badRequest", "to must be after from.");
  return { request, from, to };
}
export function parseQueryTime(value: unknown): number {
  let seconds = value;
  if (typeof value === "string" && /^\d+(?::\d{1,2})*(?:\.\d+)?$/.test(value))
    seconds = value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
    throw new QueryError("badRequest", "Time must be nonnegative seconds or mm:ss.mmm.");
  try {
    return Time.fromSeconds(seconds).seconds;
  } catch {
    throw new QueryError("badRequest", "Time is outside the supported range.");
  }
}
const base = (path: string) => path.split(/[\\/]/).at(-1)!;
export const clipMediaID = (clip: Clip) => {
  const value = clip.content.media;
  return value &&
    typeof value === "object" &&
    "mediaID" in value &&
    typeof value.mediaID === "string"
    ? value.mediaID
    : undefined;
};
const clock = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
export function queryTracks(project: Project) {
  return [
    ...project.videoTracks
      .map((track, index) => ({ track, label: `V${index + 1} ${track.name}` }))
      .reverse(),
    ...project.audioTracks.map((track, index) => ({ track, label: `A${index + 1} ${track.name}` })),
  ];
}
function content(clip: Clip, project: Project) {
  const mediaID = clipMediaID(clip);
  if (mediaID) {
    const media = project.media.find((m) => m.id === mediaID);
    const name = media
      ? project.media.filter((m) => base(m.path) === base(media.path)).length > 1
        ? media.path
        : base(media.path)
      : `${mediaID} (missing)`;
    return media?.kind === "image"
      ? name
      : clip.freezeFrame
        ? `${name} frozen at ${clock(clip.sourceStart.seconds)}`
        : `${name} [${clock(clip.sourceStart.seconds)}-${clock(clip.sourceStart.seconds + clip.duration.seconds * clip.speed)}]`;
  }
  if (clip.content.text)
    return `text "${String(object(clip.content.text).text).replaceAll("\n", " / ").slice(0, 48)}"`;
  if (clip.content.graphic) return `graphic ${String(object(clip.content.graphic).template)}`;
  return "solid" in clip.content ? "solid" : "adjustment";
}
export function queryClips(file: ProjectFile, input: unknown) {
  const { request, from, to } = queryRequest("clips", input),
    { project, revision } = file;
  const tracks = queryTracks(project);
  let trackID: string | undefined;
  if (request.track != null) {
    trackID = tracks.find(
      ({ track, label }) =>
        track.id === request.track ||
        track.name.toLowerCase() === String(request.track).toLowerCase() ||
        label.split(" ")[0]!.toLowerCase() === String(request.track).toLowerCase(),
    )?.track.id;
    if (!trackID)
      throw new QueryError("notFound", `There is no track "${String(request.track)}".`, revision);
  }
  let mediaIDs: Set<string> | undefined;
  if (request.media != null) {
    const wanted = String(request.media).toLowerCase().replaceAll("\\", "/");
    const media = project.media.filter(
      (m) =>
        m.id === request.media ||
        m.path.toLowerCase().replaceAll("\\", "/") === wanted ||
        base(m.path).toLowerCase() === wanted ||
        m.path.toLowerCase().replaceAll("\\", "/").endsWith(`/${wanted}`),
    );
    if (!media.length)
      throw new QueryError("notFound", `No media matches "${String(request.media)}".`, revision);
    mediaIDs = new Set(media.map((m) => m.id));
  }
  const clips = tracks
    .filter(({ track }) => trackID === undefined || track.id === trackID)
    .flatMap(({ track, label }) =>
      track.clips
        .filter(
          (clip) =>
            (from === null || clip.start.seconds + clip.duration.seconds > from) &&
            (to === null || clip.start.seconds < to) &&
            (!mediaIDs || mediaIDs.has(clipMediaID(clip) ?? "")),
        )
        .map((clip) => ({
          id: clip.id,
          track: label,
          trackID: track.id,
          start: clip.start.seconds,
          end: clip.start.seconds + clip.duration.seconds,
          duration: clip.duration.seconds,
          content: content(clip, project),
          ...(clipMediaID(clip) ? { mediaID: clipMediaID(clip) } : {}),
          ...(clip.name == null ? {} : { name: clip.name }),
          enabled: clip.enabled,
        })),
    );
  return { revision, clips, ...(request.ids === true ? { idsOnly: true } : {}) };
}
export function queryTimeline(file: ProjectFile, input: unknown) {
  const { request, from, to } = queryRequest("timeline", input),
    { project, revision } = file;
  const overlaps = (start: number, end: number) =>
    (from === null || end > from) && (to === null || start < to);
  if (request.format === "json") {
    const filtered = {
      ...project,
      videoTracks: project.videoTracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) =>
          overlaps(c.start.seconds, c.start.seconds + c.duration.seconds),
        ),
      })),
      audioTracks: project.audioTracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) =>
          overlaps(c.start.seconds, c.start.seconds + c.duration.seconds),
        ),
      })),
      markers: project.markers.filter((m) =>
        overlaps(m.time, m.time + Math.max(m.duration, 1 / 705600000)),
      ),
    };
    return {
      revision,
      project: JSON.parse(encodeProjectFile({ ...file, project: filtered })).project,
    };
  }
  const tracks = queryTracks(project),
    duration = Math.max(
      0,
      ...tracks.flatMap(({ track }) =>
        track.clips.map((c) => c.start.seconds + c.duration.seconds),
      ),
    );
  const lines = [
    `${project.name}: ${clock(duration)} long, ${project.settings.width}x${project.settings.height} at ${project.settings.frameRate.numerator / project.settings.frameRate.denominator} fps, revision ${revision}`,
  ];
  const listed = queryClips(file, {
    ...(request.from == null ? {} : { from: request.from }),
    ...(request.to == null ? {} : { to: request.to }),
  }).clips;
  if (request.summary)
    lines.push(
      `${tracks.length} tracks, ${tracks.reduce((sum, { track }) => sum + track.clips.length, 0)} clips, ${project.media.length} media files. Read part of it in full with from and to.`,
    );
  for (const marker of project.markers.filter(
    (m) => request.summary || overlaps(m.time, m.time + Math.max(m.duration, 1 / 705600000)),
  ))
    lines.push(`  ${clock(marker.time)}  ${marker.kind}  "${marker.name}"  ${marker.id}`);
  for (const { track, label } of tracks) {
    lines.push(
      `${label}  ${track.id}  ${track.rippleMode}${request.summary ? `  ${track.clips.length} clips` : ""}`,
    );
    if (!request.summary)
      for (const clip of listed.filter((c) => c.trackID === track.id))
        lines.push(
          `  ${clip.id}  ${clock(clip.start)}-${clock(clip.end)}  ${clip.duration.toFixed(3)}s  ${clip.content}${clip.enabled ? "" : "  disabled"}`,
        );
  }
  if (request.words)
    lines.push(
      "Speech words are unavailable through the desktop service; inspect the editor's transcript cache.",
    );
  return { revision, text: lines.join("\n") + "\n" };
}
