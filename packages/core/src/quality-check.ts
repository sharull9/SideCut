// Model/frame checks from TandemCore/QualityCheck.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project } from "@sidecut/contracts/project";
import { queryClips, clipMediaID, QueryError } from "./project-queries";
import { projectDuration } from "./render-plan";
import { unionRanges, type Range } from "./speech";
import { transitionWindow } from "./transitions";
export interface CheckProblem {
  kind: string;
  start: number;
  end: number;
  frames?: number;
  message: string;
  clipIDs: string[];
  fix?: { holdFrame: { clipID: string; range: { start: number; duration: number } } };
}
export interface FrameStats {
  time: number;
  luma: number;
  brightestTile: number;
  flatGreen: number;
  flatWhite: number;
  thumbnail: number[];
  scanlines?: number[];
}
export function checkRanges(project: Project, request: Record<string, unknown>, changed?: Range[]) {
  if (
    request.cuts !== true &&
    request.width != null &&
    (Number(request.width) < 64 || Number(request.width) > 1920)
  )
    throw new QueryError("badRequest", "width must be 64 to 1920 pixels.");
  if (request.quick === true && request.cuts === true)
    throw new QueryError("badRequest", "A cuts check does not take quick.");
  if (request.changed === true && (request.from != null || request.to != null))
    throw new QueryError("badRequest", "Give changed or a time range, not both.");
  const duration = projectDuration(project).seconds;
  if (request.changed === true)
    return unionRanges(
      (changed ?? [])
        .map((r) => ({ start: Math.max(0, r.start - 0.5), end: Math.min(duration, r.end + 0.5) }))
        .filter((r) => r.end > r.start),
    );
  const start = Number(request.from ?? 0),
    end = Math.min(duration, Number(request.to ?? duration));
  if (start < 0 || end <= start)
    throw new QueryError("badRequest", "Nothing to check in that range.");
  return [{ start, end }];
}
export function modelProblems(project: Project, ranges: Range[]): CheckProblem[] {
  const frame = project.settings.frameRate.denominator / project.settings.frameRate.numerator,
    found: CheckProblem[] = [];
  const wanted = (start: number, end: number) => ranges.some((r) => start < r.end && end > r.start);
  const video = project.videoTracks.filter((t) => !t.hidden);
  const covered = unionRanges(
    video.flatMap((t) =>
      t.clips
        .filter((c) => c.enabled && !c.content.text && !c.content.adjustment)
        .map((c) => ({ start: c.start.seconds, end: c.start.add(c.duration).seconds })),
    ),
  );
  for (const range of ranges) {
    let cursor = range.start;
    const gap = (a: number, b: number) => {
      if (b - a >= frame - 1e-9)
        found.push({
          kind: "gap",
          start: a,
          end: b,
          message: `Black: nothing on any video track for ${(b - a).toFixed(3)}s.`,
          clipIDs: [],
        });
    };
    for (const span of covered.filter((r) => r.end > range.start && r.start < range.end)) {
      gap(cursor, Math.min(span.start, range.end));
      cursor = Math.max(cursor, span.end);
    }
    gap(cursor, range.end);
  }
  for (const track of [...project.videoTracks, ...project.audioTracks]) {
    let previous: (typeof track.clips)[number] | undefined;
    for (const clip of track.clips
      .filter((c) => c.enabled)
      .toSorted((a, b) => a.start.seconds - b.start.seconds)) {
      const start = clip.start.seconds,
        end = clip.start.add(clip.duration).seconds;
      if (previous) {
        const prevEnd = previous.start.add(previous.duration).seconds;
        if (start > prevEnd && start - prevEnd < frame && wanted(prevEnd, start))
          found.push({
            kind: "sliver",
            start: prevEnd,
            end: start,
            message: `Sliver: gap shorter than one frame on "${track.name}".`,
            clipIDs: [previous.id, clip.id],
          });
      }
      if (clip.duration.seconds < frame && wanted(start, end))
        found.push({
          kind: "sliver",
          start,
          end,
          message: `Sliver: clip shorter than one frame on "${track.name}".`,
          clipIDs: [clip.id],
        });
      if (!previous || end > previous.start.add(previous.duration).seconds) previous = clip;
      if (track.kind !== "video" || track.hidden || !wanted(start, end)) continue;
      const media = project.media.find((m) => m.id === clipMediaID(clip));
      if (!media?.width || !media.height) continue;
      const transform = clip.video?.transform,
        scale =
          transform && typeof transform === "object" && "scale" in transform
            ? Number(transform.scale)
            : 1;
      const largest = Math.max(
        scale,
        ...(clip.keyframes["video.transform.scale"] ?? []).map((k) => Number(k.value)),
      );
      const up =
        Math.min(project.settings.width / media.width, project.settings.height / media.height) *
        largest;
      if (up > 3.001)
        found.push({
          kind: "soft",
          start,
          end,
          message: `Soft: ${media.path} is shown at ${up.toFixed(1)}x its own pixels.`,
          clipIDs: [clip.id],
        });
    }
  }
  return found.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}
export function frameStats(
  time: number,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FrameStats {
  const columns = 16,
    rows = 9,
    tiles: { luma: number; green: boolean; white: boolean }[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      let red = 0,
        green = 0,
        blue = 0,
        sum = 0,
        square = 0,
        n = 0;
      for (
        let py = Math.floor((y * height) / rows);
        py < Math.floor(((y + 1) * height) / rows);
        py++
      )
        for (
          let px = Math.floor((x * width) / columns);
          px < Math.floor(((x + 1) * width) / columns);
          px++
        ) {
          const i = (py * width + px) * 4,
            r = data[i]! / 255,
            g = data[i + 1]! / 255,
            b = data[i + 2]! / 255,
            l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          red += r;
          green += g;
          blue += b;
          sum += l;
          square += l * l;
          n++;
        }
      const r = red / n,
        g = green / n,
        b = blue / n,
        spread = Math.sqrt(Math.max(0, square / n - (sum / n) ** 2));
      tiles.push({
        luma: sum / n,
        green: spread < 0.05 && g > 0.55 && g - Math.max(r, b) > 0.3,
        white: spread < 0.03 && Math.min(r, g, b) > 0.92,
      });
    }
  const scanlines: number[] = [];
  for (let band = 0; band < 4; band++)
    for (let row = 0; row < height; row++) {
      let sum = 0,
        n = 0;
      for (
        let col = Math.floor((band * width) / 4);
        col < Math.floor(((band + 1) * width) / 4);
        col++
      ) {
        const i = (row * width + col) * 4;
        sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        n++;
      }
      scanlines.push(Math.round(sum / Math.max(1, n)));
    }
  return {
    time,
    luma: tiles.reduce((s, t) => s + t.luma, 0) / tiles.length,
    brightestTile: Math.max(...tiles.map((t) => t.luma)),
    flatGreen: tiles.filter((t) => t.green).length / tiles.length,
    flatWhite: tiles.filter((t) => t.white).length / tiles.length,
    thumbnail: tiles.map((t) => Math.round(t.luma * 255)),
    scanlines,
  };
}
function runs(flags: boolean[]) {
  const found: { first: number; end: number }[] = [];
  let first: number | undefined;
  for (let i = 0; i <= flags.length; i++) {
    if (flags[i] && first == null) first = i;
    if (!flags[i] && first != null) {
      found.push({ first, end: i });
      first = undefined;
    }
  }
  return found;
}
export function frameProblems(
  project: Project,
  frames: FrameStats[],
  gaps: CheckProblem[],
): CheckProblem[] {
  const frame = project.settings.frameRate.denominator / project.settings.frameRate.numerator,
    found: CheckProblem[] = [];
  const pictures = (time: number) =>
    queryClips({ project, revision: 0 }, {})
      .clips.filter(
        (c) =>
          c.enabled &&
          c.start <= time &&
          c.end > time &&
          project.videoTracks.some((t) => !t.hidden && t.id === c.trackID),
      )
      .map((c) => c.id);
  const fades = project.videoTracks
    .filter((t) => !t.hidden)
    .flatMap((t) =>
      t.transitions
        .filter((v) => v.type === "fadeToBlack" || v.type === "fadeFromBlack")
        .flatMap((v) => {
          const w = transitionWindow(t, v);
          return w ? [{ start: w.start, end: w.end }] : [];
        }),
    );
  const difference = (a: FrameStats, b: FrameStats) =>
    a.thumbnail.reduce((sum, v, i) => sum + Math.abs(v - (b.thumbnail[i] ?? v)), 0) /
    (a.thumbnail.length * 255);
  const groups: FrameStats[][] = [];
  for (const value of frames) {
    const last = groups.at(-1);
    if (last && value.time - last.at(-1)!.time <= frame * 1.5) last.push(value);
    else groups.push([value]);
  }
  for (const group of groups) {
    const add = (kind: string, first: number, end: number, message: string) => {
      const start = group[first]!.time,
        stop = group[end - 1]!.time + frame;
      found.push({
        kind,
        start,
        end: stop,
        frames: end - first,
        message,
        clipIDs: pictures(start),
      });
    };
    for (const r of runs(
      group.map(
        (f) =>
          f.luma < 0.02 &&
          f.brightestTile < 0.05 &&
          ![...gaps, ...fades].some((q) => q.start <= f.time && q.end > f.time),
      ),
    ))
      add(
        "black",
        r.first,
        r.end,
        `Black: ${r.end - r.first} frames render black with something on the timeline.`,
      );
    for (const r of runs(group.map((f) => f.flatGreen >= 0.01)))
      add("unkeyed", r.first, r.end, "Green screen: flat green remains visible.");
    for (const r of runs(group.map((f) => f.flatWhite >= 0.05))) {
      if (r.end - r.first <= 45 && r.first > 0 && r.end < group.length) {
        const least = Math.min(...group.slice(r.first, r.end).map((f) => f.flatWhite));
        if (group[r.first - 1]!.flatWhite < least / 3 && group[r.end]!.flatWhite < least / 3)
          add("whiteBlock", r.first, r.end, "White block: a flat white patch comes and goes.");
      }
    }
    for (let i = 1; i < group.length - 1; i++)
      for (let length = 1; length <= 3 && i + length < group.length; length++) {
        if (
          difference(group[i - 1]!, group[i + length]!) < 0.03 &&
          difference(group[i]!, group[i - 1]!) > 0.1 &&
          difference(group[i + length - 1]!, group[i + length]!) > 0.1
        ) {
          const start = group[i]!.time,
            end = group[i + length - 1]!.time + frame;
          if (!found.some((p) => p.start === start && Math.abs(p.end - end) < 1e-8))
            add(
              "flicker",
              i,
              i + length,
              `Flicker: ${length} frames unlike the matching neighbours.`,
            );
          i += length;
          break;
        }
      }
  }
  for (const p of found.filter((candidate) => candidate.kind === "flicker")) {
    const candidates = project.videoTracks
      .filter((t) => !t.hidden && !t.locked)
      .flatMap((t) =>
        t.clips.filter(
          (c) =>
            c.enabled &&
            !c.freezeFrame &&
            c.start.seconds <= p.start - frame + 1e-9 &&
            c.start.add(c.duration).seconds >= p.end + frame - 1e-9 &&
            project.media.some((m) => m.id === clipMediaID(c) && m.kind === "video" && m.hasVideo),
        ),
      );
    if (candidates.length === 1)
      p.fix = {
        holdFrame: {
          clipID: candidates[0]!.id,
          range: { start: p.start, duration: p.end - p.start },
        },
      };
  }
  return found.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}
