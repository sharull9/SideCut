import type { ProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { Time } from "@sidecut/contracts/time";
import {
  speechMap,
  searchSpeech,
  findPauses,
  planTighten,
  planCaptions,
  mediaIDOf,
  type Transcripts,
  type TightenRequest,
  type CaptionsRequest,
} from "./speech";
import { placeWords } from "./transcript";
import { QueryError, queryTracks } from "./project-queries";
import { planShort } from "./short";
import { cardPlacements } from "./section-cards";
import { clipChanges } from "./service-edits";

export function speechQuery(
  file: ProjectFile,
  operation: string,
  request: Record<string, unknown>,
  transcripts: Transcripts,
) {
  const map = speechMap(file.project, transcripts),
    from = request.from as number | undefined,
    to = request.to as number | undefined;
  if (operation === "search")
    return searchSpeech(
      file,
      String(request.phrase),
      transcripts,
      request.limit as number | undefined,
    );
  if (operation === "pauses") {
    const minimum = Number(request.min ?? 0.6);
    if (minimum <= 0) throw new QueryError("badRequest", "Minimum pause must be positive.");
    const pauses = findPauses(map, minimum, from, to);
    return {
      revision: file.revision,
      minimum,
      pauses,
      total: pauses.reduce((sum, p) => sum + p.duration, 0),
      missing: map.missing,
    };
  }
  const id = request.id as string | undefined,
    media = file.project.media.find((m) => m.id === id),
    clip = [...file.project.videoTracks, ...file.project.audioTracks]
      .flatMap((t) => t.clips)
      .find((c) => c.id === id);
  if (id && !media && !clip)
    throw new QueryError("notFound", `No media or clip matches ${id}.`, file.revision);
  const item = media ?? file.project.media.find((m) => m.id === (clip ? mediaIDOf(clip) : null));
  const transcript = item ? transcripts(item) : undefined;
  const words = media
    ? (transcript?.words ?? [])
    : clip
      ? transcript
        ? placeWords(transcript, [clip], { includeDisabled: true })
        : []
      : map.words;
  return {
    revision: file.revision,
    scope: media ? "media" : clip ? "clip" : "timeline",
    ...(id ? { id } : {}),
    timelineTimes: !media,
    words: words
      .filter((w) => (from == null || w.end > from) && (to == null || w.start < to))
      .map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        ...("clipID" in w ? { clipID: w.clipID } : {}),
      })),
    missing: item ? (transcript ? [] : [item.id]) : map.missing,
  };
}
export function helperPlan(
  file: ProjectFile,
  operation: string,
  request: Record<string, unknown>,
  transcripts: Transcripts,
) {
  if (operation === "tighten") return planTighten(file, request as TightenRequest, transcripts);
  if (operation === "captions") return planCaptions(file, request as CaptionsRequest, transcripts);
  if (operation === "short") return planShort(file);
  if (operation === "cards") {
    const duration =
      request.duration == null ? undefined : Time.fromSeconds(Number(request.duration));
    const markers = request.markers as string[] | undefined,
      kicker = request.kicker as string | undefined;
    const placements = cardPlacements(file.project, markers, duration, kicker);
    const track = request.track
      ? queryTracks(file.project).find(
          ({ track: row, label }) =>
            row.id === request.track || row.name === request.track || label === request.track,
        )?.track
      : undefined;
    if (request.track && (!track || track.kind !== "video"))
      throw new QueryError("notFound", "Cards need an existing video track.");
    const commands = placements.length
      ? [
          {
            addSectionCards: {
              ...(markers ? { markerIDs: markers } : {}),
              ...(duration ? { duration: duration.seconds } : {}),
              ...(kicker ? { kicker } : {}),
              ...(track ? { trackID: track.id } : {}),
              mode: request.insert === true ? "insert" : "overwrite",
            },
          },
        ]
      : [];
    return {
      revision: file.revision,
      cards: placements.map((p) => ({
        number: p.number,
        title: p.marker.name,
        markerID: p.marker.id,
        at: p.marker.time,
        start: p.start.seconds,
        end: p.start.seconds + p.duration.seconds,
        ...(p.existingClipID ? { existingClipID: p.existingClipID } : {}),
      })),
      commands,
      label: "Add section cards",
      sounds: "none",
      warnings: [
        ...(request.sounds !== false
          ? ["Library whooshes are unavailable through this adapter; cards have no added sound."]
          : []),
        ...(request.insert === true
          ? [
              "Card insertion uses marker times; speech-aware section cuts are unavailable through this adapter.",
            ]
          : []),
      ],
    };
  }
  const range =
    request.from != null || request.to != null
      ? {
          start: Number(request.from ?? 0),
          duration:
            Number(
              request.to ??
                Math.max(
                  0,
                  ...queryTracks(file.project).flatMap(({ track }) =>
                    track.clips.map((c) => c.start.seconds + c.duration.seconds),
                  ),
                ),
            ) - Number(request.from ?? 0),
        }
      : null;
  const commands = [{ joinThroughEdits: { range } }],
    copy = new ProjectCoordinator(file),
    result = copy.apply({ commands, label: "Join through-edits" });
  const changes = clipChanges(file, copy.projectFile());
  const joins = changes
    .filter((c) => c.kind === "removed")
    .map((c) => ({
      time: c.start,
      clips: [
        {
          track: c.track,
          trackID: c.trackID,
          nextClipID: c.id,
          clipID:
            changes.find(
              (other) =>
                other.kind === "changed" &&
                other.trackID === c.trackID &&
                other.start <= c.start &&
                other.end > c.start,
            )?.id ?? "",
        },
      ],
    }));
  return {
    revision: file.revision,
    joins,
    skipped: result.warnings
      .filter((w) => w.startsWith("Didn't join"))
      .map((message) => ({ message })),
    commands: joins.length ? commands : [],
    warnings: [...result.warnings],
    label: "Join through-edits",
  };
}
