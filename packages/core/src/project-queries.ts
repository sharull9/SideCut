// TandemAPI ServiceTypes.swift, Diff.swift and TimelineDump.swift at 735a9b8.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, ProjectFile } from "@sidecut/contracts/project";
import { encodeProjectFile } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { object } from "./import-builder";
import { timelineText, timelineContent as content, queryTracks } from "./timeline-dump";
import type { Transcripts } from "./speech";
export { queryTracks } from "./timeline-dump";

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
export const queryDefinitions = {
  status: {},
  media: { refresh: "boolean" },
  timeline: { from: "time", to: "time", format: "string", words: "boolean", summary: "boolean" },
  clips: { track: "string", from: "time", to: "time", media: "string", ids: "boolean" },
} as const;
export function queryRequest(operation: string, input: unknown) {
  const time = (value: unknown) =>
    parseQueryTime(value, operation === "timeline" || operation === "clips");
  const request = object(input);
  const fields: Record<string, Record<string, string>> = queryDefinitions;
  const accepted = Object.hasOwn(fields, operation) ? fields[operation] : undefined;
  if (!accepted) throw new QueryError("notFound", `Unknown project query: ${operation}.`);
  for (const [key, value] of Object.entries(request)) {
    const type = Object.hasOwn(accepted, key) ? accepted[key] : undefined;
    if (!type) throw new QueryError("badRequest", `Unknown ${operation} field: ${key}.`);
    if (value == null) continue;
    if (type === "time") time(value);
    else if (typeof value !== type) throw new QueryError("badRequest", `Invalid ${key}.`);
  }
  if (request.format != null && !["text", "json"].includes(String(request.format)))
    throw new QueryError("badRequest", "format must be text or json.");
  const from = request.from == null ? null : time(request.from),
    to = request.to == null ? null : time(request.to);
  if (from !== null && to !== null && to <= from)
    throw new QueryError("badRequest", "to must be after from.");
  return { request, from, to };
}
export function parseQueryTime(value: unknown, allowNegative = false): number {
  let seconds = value;
  if (typeof value === "string") {
    let text = value.trim();
    const negative = text.startsWith("-");
    if (negative) text = text.slice(1);
    if (text.endsWith("s")) text = text.slice(0, -1);
    const parts = text.split(":");
    if (
      parts.length > 3 ||
      parts.some(
        (part, i) =>
          !(i === parts.length - 1 ? /^(?:\d+(?:\.\d*)?|\.\d+)$/ : /^\d+$/).test(part) ||
          (i > 0 && Number(part) >= 60),
      )
    )
      throw new QueryError("badRequest", "Time must be seconds or mm:ss.mmm.");
    seconds = parts.reduce((sum, part) => sum * 60 + Number(part), 0) * (negative ? -1 : 1);
  }
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || (!allowNegative && seconds < 0))
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
export function queryTimeline(file: ProjectFile, input: unknown, transcripts?: Transcripts) {
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
        transitions: t.transitions.filter((transition) =>
          [transition.fromClipID, transition.toClipID]
            .filter((id) => id != null)
            .every((id) =>
              t.clips.some(
                (c) =>
                  c.id === id && overlaps(c.start.seconds, c.start.seconds + c.duration.seconds),
              ),
            ),
        ),
      })),
      audioTracks: project.audioTracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) =>
          overlaps(c.start.seconds, c.start.seconds + c.duration.seconds),
        ),
        transitions: t.transitions.filter((transition) =>
          [transition.fromClipID, transition.toClipID]
            .filter((id) => id != null)
            .every((id) =>
              t.clips.some(
                (c) =>
                  c.id === id && overlaps(c.start.seconds, c.start.seconds + c.duration.seconds),
              ),
            ),
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
  return {
    revision,
    text: timelineText(file, {
      from,
      to,
      summary: request.summary === true,
      ...(request.words === true ? { transcripts: transcripts ?? (() => undefined) } : {}),
    }),
  };
}
