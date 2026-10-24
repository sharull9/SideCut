import type { ProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { joinThroughEdits } from "./through-edits";
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
import { cardPlacements, cardOf } from "./section-cards";
import { sectionCuts } from "./section-cuts";

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
    let placements = cardPlacements(file.project, markers, duration, kicker);
    const selected =
      request.insert === true
        ? sectionCuts(file.project, placements, transcripts)
        : { cuts: {}, warnings: [] };
    if (Object.keys(selected.cuts).length)
      placements = cardPlacements(file.project, markers, duration, kicker, selected.cuts);
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
              ...(Object.keys(selected.cuts).length
                ? {
                    cuts: Object.fromEntries(
                      Object.entries(selected.cuts).map(([id, time]) => [id, time.seconds]),
                    ),
                  }
                : {}),
            },
          },
        ]
      : [];
    const checked = new ProjectCoordinator(file).apply({ commands });
    return {
      revision: file.revision,
      cards: placements.map((p) => {
        const existing = p.existingClipID
          ? queryTracks(file.project)
              .flatMap((t) => t.track.clips)
              .find((c) => c.id === p.existingClipID)
          : undefined;
        const props = existing ? cardOf(existing) : null,
          subtitle = props?.subtitle ?? p.marker.note;
        return {
          number: p.number,
          title: props?.title || p.marker.name,
          ...(subtitle ? { subtitle } : {}),
          markerID: p.marker.id,
          at: p.marker.time,
          start: p.start.seconds,
          end: p.start.add(p.duration).seconds,
          ...(p.existingClipID ? { existingClipID: p.existingClipID } : {}),
          ...(request.insert === true && !p.existingClipID ? { cut: p.cut.seconds } : {}),
        };
      }),
      commands,
      label: `Add ${placements.length} section card${placements.length === 1 ? "" : "s"}`,
      sounds:
        request.sounds === false
          ? "no sounds (asked for none)"
          : "silent: the section card whooshes are not available in the local asset library",
      warnings: [...selected.warnings, ...checked.warnings],
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
  if (range) range.duration = Math.max(0, range.duration);
  const command = { joinThroughEdits: { range } },
    copy = new ProjectCoordinator(file);
  copy.apply({ commands: [command], label: "Join through-edits" });
  const report = joinThroughEdits(
      file.project,
      range
        ? { start: Time.fromSeconds(range.start), duration: Time.fromSeconds(range.duration) }
        : null,
    ),
    labels = queryTracks(file.project),
    label = (id: string) => labels.find((t) => t.track.id === id)?.label ?? id;
  return {
    revision: file.revision,
    joins: report.joins.map((join) => ({
      time: join.time,
      clips: [...join.pairs]
        .sort(
          (a, b) =>
            labels.findIndex((t) => t.track.id === a.trackID) -
            labels.findIndex((t) => t.track.id === b.trackID),
        )
        .map((pair) => ({ ...pair, track: label(pair.trackID) })),
    })),
    skipped: report.skipped.map(({ message: _message, ...skip }) => ({
      ...skip,
      track: label(skip.trackID),
    })),
    commands: report.joins.length ? [command] : [],
    warnings: [],
    label: `Join ${report.joins.length} through-edit${report.joins.length === 1 ? "" : "s"}`,
  };
}
