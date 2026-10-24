import { screenProject, pageNotes, deadAirNotes, lowRateNotes } from "@sidecut/core/quality-notes";
import type { BrowserProjectSession } from "./browser-session";
import {
  modelProblems,
  frameProblems,
  frameStats,
  type FrameStats,
} from "@sidecut/core/quality-check";
import { speechEnergy, speechLevels, auditCut } from "@sidecut/core/cut-audit";
import { speechTracks, speechMap, mediaIDOf, type Range } from "@sidecut/core/speech";
import { queryClips, QueryError } from "@sidecut/core/project-queries";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { paintPicture } from "@sidecut/platform-browser/picture";
import { createLUTLoader } from "@sidecut/platform-browser/lut";
import { readMono } from "@sidecut/platform-browser/source-analysis";
export async function checkService(
  session: BrowserProjectSession,
  request: Record<string, unknown>,
  ranges: Range[],
  signal: AbortSignal,
) {
  const file = session.projectFile(),
    project = file.project,
    began = performance.now(),
    warnings: string[] = [];
  const names = Object.fromEntries(
    queryClips(file, {}).clips.map((c) => [c.id, c.name ?? c.content]),
  );
  if (request.cuts === true) {
    const problems: {
      kind: string;
      start: number;
      end: number;
      message: string;
      clipIDs: string[];
      cut: {
        clipID: string;
        edge: "start" | "end";
        to?: number;
        fix?: { trim: { clipID: string; edge: "start" | "end"; to: number; ripple: boolean } };
      };
    }[] = [];
    let checked = 0;
    const energies = new Map<string, ReturnType<typeof speechEnergy> | null>(),
      frame = project.settings.frameRate.denominator / project.settings.frameRate.numerator;
    for (const track of speechTracks(project)) {
      const clips = track.clips
        .filter(
          (c) =>
            c.enabled &&
            !c.audio?.muted &&
            !c.freezeFrame &&
            project.media.some(
              (m) => m.id === mediaIDOf(c) && m.hasAudio && !["sfx", "music"].includes(m.role),
            ),
        )
        .toSorted((a, b) => a.start.seconds - b.start.seconds);
      const through = (a: (typeof clips)[number], b: (typeof clips)[number]) =>
        mediaIDOf(a) === mediaIDOf(b) &&
        a.speed === b.speed &&
        Math.abs(a.sourceStart.seconds + a.duration.seconds * a.speed - b.sourceStart.seconds) <=
          frame / 2;
      for (const [index, clip] of clips.entries())
        for (const edge of ["start", "end"] as const) {
          const previous = clips[index - 1],
            next = clips[index + 1],
            other = edge === "start" ? previous : next,
            time = edge === "start" ? clip.start.seconds : clip.start.add(clip.duration).seconds;
          if (
            other &&
            Math.abs(
              (edge === "start" ? other.start.add(other.duration).seconds : other.start.seconds) -
                time,
            ) <=
              frame / 2 &&
            (edge === "start" ? through(other, clip) : through(clip, other))
          )
            continue;
          if (!ranges.some((r) => r.start <= time && r.end >= time)) continue;
          checked++;
          const id = mediaIDOf(clip)!,
            media = project.media.find((m) => m.id === id)!;
          if (!energies.has(id)) {
            try {
              const resource = await session.resource(id);
              if (resource?.state !== "available") throw new Error("Source is missing.");
              const samples = await readMono(resource.file, media, 32000, signal, () => {});
              energies.set(id, speechEnergy(samples));
            } catch (error) {
              signal.throwIfAborted();
              warnings.push(
                `Could not inspect ${media.path}: ${error instanceof Error ? error.message : String(error)}`,
              );
              energies.set(id, null);
            }
          }
          const energy = energies.get(id);
          if (!energy) continue;
          signal.throwIfAborted();
          const sourceTime =
              edge === "start"
                ? clip.sourceStart.seconds
                : clip.sourceStart.seconds + clip.duration.seconds * clip.speed,
            verdict = auditCut(
              energy,
              speechLevels(energy),
              sourceTime,
              edge === "end" ? "before" : "after",
            );
          if (!verdict.clipped) continue;
          const cut: {
            clipID: string;
            edge: "start" | "end";
            to?: number;
            fix?: { trim: { clipID: string; edge: "start" | "end"; to: number; ripple: boolean } };
          } = { clipID: clip.id, edge };
          if (verdict.suggestion != null && verdict.pause) {
            const ideal = (verdict.suggestion - sourceTime) / clip.speed;
            const delta =
              [Math.floor(ideal / frame) * frame, Math.ceil(ideal / frame) * frame]
                .filter(
                  (d) =>
                    sourceTime + d * clip.speed >= verdict.pause![0]! &&
                    sourceTime + d * clip.speed <= verdict.pause![1]!,
                )
                .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0] ?? ideal;
            const length = clip.duration.seconds + (edge === "end" ? delta : -delta);
            const within =
              clip.holdEdges ||
              (edge === "start"
                ? clip.sourceStart.seconds + delta * clip.speed >= 0
                : sourceTime + delta * clip.speed <= (media.duration?.seconds ?? Infinity) + frame);
            if (length >= frame && within) {
              cut.to = time + delta;
              cut.fix = { trim: { clipID: clip.id, edge, to: cut.to, ripple: true } };
            }
          }
          problems.push({
            kind: "clippedWord",
            start: time,
            end: time,
            message: `Clipped word at the ${edge} of ${clip.id}: voice continues across the cut.`,
            clipIDs: other ? [clip.id, other.id] : [clip.id],
            cut,
          });
        }
    }
    problems.sort((a, b) => a.start - b.start || (a.cut.edge === "end" ? -1 : 1));
    return {
      revision: file.revision,
      ranges: ranges.map((r) => ({ start: r.start, duration: r.end - r.start })),
      frames: 0,
      seconds: (performance.now() - began) / 1000,
      problems,
      notes: [],
      clipNames: names,
      warnings,
      cuts: checked,
      commands: problems.toReversed().flatMap((p) => (p.cut.fix ? [p.cut.fix] : [])),
      ok: problems.length === 0,
    };
  }
  const width = Number(request.width ?? 384);
  if (!Number.isSafeInteger(width) || width < 64 || width > 1920)
    throw new QueryError("badRequest", "width must be 64 to 1920 pixels.");
  const fps = project.settings.frameRate.numerator / project.settings.frameRate.denominator;
  if (ranges.reduce((n, r) => n + Math.ceil((r.end - r.start) * fps), 0) > 18000)
    throw new QueryError("badRequest", "Checks are limited to 18000 frames per request.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(
    9,
    Math.round((width * project.settings.height) / project.settings.width),
  );
  if (canvas.width * canvas.height > 8000000)
    throw new QueryError("badRequest", "Check image is too large.");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  const sampleBudget =
    ranges.reduce((n, r) => n + Math.ceil((r.end - r.start) * fps), 0) *
    (144 + canvas.height * 4) *
    (project.media.some((m) => m.role === "screen") ? 2 : 1);
  if (sampleBudget > 40000000)
    throw new QueryError(
      "badRequest",
      "Check statistics exceed the memory budget. Use a smaller width or shorter range.",
    );
  const readers = new Map<string, Promise<LocalMediaReader>>(),
    reader = (id: string) => {
      let entry = readers.get(id);
      if (!entry) {
        entry = (async () => {
          const media = project.media.find((m) => m.id === id),
            local = await session.resource(id);
          if (!media || local?.state !== "available")
            throw new Error(`Missing check source ${id}.`);
          return LocalMediaReader.open(local.file, media.kind, width);
        })();
        readers.set(id, entry);
      }
      return entry;
    };
  const lut = createLUTLoader((id) => session.resource(id)),
    stats: FrameStats[] = [];
  const screen = screenProject(project),
    screenFrames: FrameStats[] = [],
    frameTimes = new Map<string, number[]>();
  await session.analysis.prepareSpeech();
  const missing = speechMap(project, session.analysis.transcriptFor).missing;
  if (missing.length)
    warnings.push(
      `No transcript for ${missing.join(", ")}; dead air is not checked where those files play.`,
    );
  try {
    for (const item of screen
      ? project.media.filter((m) => m.role === "screen" && m.hasVideo)
      : []) {
      try {
        frameTimes.set(item.id, await (await reader(item.id)).frameTimes(signal));
      } catch (error) {
        signal.throwIfAborted();
        warnings.push(
          `Source frame times unavailable for ${item.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const range of ranges)
      for (let i = Math.ceil(range.start * fps - 1e-7); i / fps < range.end - 1e-9; i++) {
        signal.throwIfAborted();
        const time = i / fps;
        await paintPicture(context, project, time, reader, signal, lut);
        stats.push(
          frameStats(
            time,
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          ),
        );
        if (
          screen &&
          screen.videoTracks.some((t) =>
            t.clips.some((c) => c.start.seconds <= time && c.start.add(c.duration).seconds > time),
          )
        ) {
          await paintPicture(context, screen, time, reader, signal, lut);
          screenFrames.push(
            frameStats(
              time,
              context.getImageData(0, 0, canvas.width, canvas.height).data,
              canvas.width,
              canvas.height,
            ),
          );
        }
        if (i % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    const model = modelProblems(project, ranges),
      found = [
        ...model,
        ...frameProblems(
          project,
          stats,
          model.filter((p) => p.kind === "gap"),
        ),
      ],
      notes = [
        ...found.filter((p) => ["soft", "sliver"].includes(p.kind)),
        ...deadAirNotes(
          project,
          ranges,
          stats,
          session.analysis.transcriptFor,
          model.filter((p) => p.kind === "gap"),
        ),
        ...pageNotes(project, ranges, screenFrames),
        ...lowRateNotes(project, ranges, screenFrames, frameTimes),
      ].sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind)),
      problems = found.filter((p) => !["soft", "sliver"].includes(p.kind));

    return {
      revision: file.revision,
      ok: !problems.length,
      ranges: ranges.map((r) => ({ start: r.start, duration: r.end - r.start })),
      frames: stats.length,
      seconds: (performance.now() - began) / 1000,
      problems,
      notes,
      clipNames: names,
      warnings,
      commands: problems
        .toSorted((a, b) => b.start - a.start)
        .flatMap((p) => (p.fix ? [p.fix] : [])),
    };
  } finally {
    for (const pending of readers.values()) (await pending.catch(() => null))?.close();
  }
}
