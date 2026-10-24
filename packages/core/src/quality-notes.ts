// Ported from TandemCore/DeadAir.swift, PageChanges.swift and LowFrameRate.swift at 735a9b8.
// See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project, Clip } from "@sidecut/contracts/project";
import { resolveClip } from "./keyframes";
import { layerGeometry } from "./render-plan";
import { clipMediaID } from "./project-queries";
import { speechMap, unionRanges, type Range, type Transcripts } from "./speech";
import { transitionWindow } from "./transitions";
import { cardOf } from "./section-cards";
import type { CheckProblem, FrameStats } from "./quality-check";
const active = (c: Clip, t: number) =>
  c.enabled && c.start.seconds <= t && c.start.add(c.duration).seconds > t;
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {};
function box(c: Clip, time: number, p: Project) {
  if (c.content.text || c.content.adjustment) return null;
  const clip = resolveClip(c, time),
    media = p.media.find((m) => m.id === clipMediaID(c));
  if (c.content.media && (!media || (!media.hasVideo && media.kind !== "image"))) return null;
  if (Number(clip.video?.opacity ?? 1) <= 0) return null;
  const w = p.settings.width,
    h = p.settings.height,
    g = layerGeometry(clip, w, h, media?.width ?? w, media?.height ?? h),
    crop = object(clip.video?.crop);
  return {
    x0: Math.max(0, (g.x + (Number(crop.left ?? 0) - 0.5) * g.width) / w),
    y0: Math.max(0, (g.y + (Number(crop.top ?? 0) - 0.5) * g.height) / h),
    x1: Math.min(1, (g.x + (0.5 - Number(crop.right ?? 0)) * g.width) / w),
    y1: Math.min(1, (g.y + (0.5 - Number(crop.bottom ?? 0)) * g.height) / h),
  };
}
function screenAt(p: Project, t: number) {
  for (const [index, track] of [...p.videoTracks.entries()].reverse()) {
    if (track.hidden) continue;
    const clip = track.clips.find(
      (c) => active(c, t) && p.media.some((m) => m.id === clipMediaID(c) && m.role === "screen"),
    );
    if (clip) return { index, clip };
  }
  return null;
}
function screenShows(p: Project, t: number) {
  const screen = screenAt(p, t);
  if (!screen) return false;
  return !p.videoTracks
    .slice(screen.index + 1)
    .filter((track) => !track.hidden)
    .some((track) =>
      track.clips.some((c) => {
        if (!active(c, t) || object(c.video?.cutout).enabled === true) return false;
        const b = box(c, t, p);
        return b && Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) >= 0.5;
      }),
    );
}
export function screenProject(p: Project): Project | null {
  let any = false;
  const videoTracks = p.videoTracks.map((track) => ({
    ...track,
    transitions: [],
    clips: track.hidden
      ? []
      : track.clips.flatMap((c) => {
          if (
            !c.enabled ||
            !p.media.some((m) => m.id === clipMediaID(c) && m.role === "screen" && m.hasVideo)
          )
            return [];
          any = true;
          return [{ ...c, video: null, keyframes: {} }];
        }),
  }));
  return any
    ? {
        ...p,
        videoTracks,
        audioTracks: p.audioTracks.map((t) => ({ ...t, clips: [], transitions: [] })),
      }
    : null;
}
export const changedShare = (a: FrameStats, b: FrameStats) =>
  a.thumbnail.length !== b.thumbnail.length
    ? 1
    : a.thumbnail.filter((v, i) => Math.abs(v - b.thumbnail[i]!) > 6).length /
      Math.max(1, a.thumbnail.length);
const meanChange = (a: FrameStats, b: FrameStats) =>
  a.thumbnail.reduce((sum, v, i) => sum + Math.abs(v - b.thumbnail[i]!), 0) /
  Math.max(1, a.thumbnail.length);
function contiguous(frames: FrameStats[], frame: number) {
  const groups: FrameStats[][] = [];
  for (const f of frames) {
    const last = groups.at(-1);
    if (last && f.time - last.at(-1)!.time <= frame * 1.5) last.push(f);
    else groups.push([f]);
  }
  return groups;
}
export function isScroll(before: number[], after: number[]) {
  if (before.length !== after.length || before.length % 4 || before.length / 4 < 12) return false;
  const height = before.length / 4;
  let unmoved = 0,
    matched = 0;
  for (let band = 0; band < 4; band++) {
    const a = before.slice(band * height, (band + 1) * height),
      b = after.slice(band * height, (band + 1) * height),
      changed = a.flatMap((v, i) => (Math.abs(v - b[i]!) > 2 ? [i] : []));
    if (changed.length < height / 10) continue;
    const still = changed.reduce((n, i) => n + Math.abs(a[i]! - b[i]!), 0) / changed.length;
    let best = still;
    for (let halves = 4; halves <= Math.max(4, Math.floor((height * 2) / 3)); halves++)
      for (const shift of [halves, -halves]) {
        const whole = Math.floor(shift / 2),
          half = shift - whole * 2;
        let total = 0,
          count = 0;
        for (const row of changed) {
          const from = row + whole;
          if (from < 0 || from + half >= height) continue;
          const moved = half ? (a[from]! + a[from + 1]!) / 2 : a[from]!;
          total += Math.abs(b[row]! - moved);
          count++;
        }
        if (count * 2 >= changed.length) best = Math.min(best, total / count);
      }
    unmoved += still * changed.length;
    matched += best * changed.length;
  }
  return unmoved / before.length >= 1 && matched / unmoved <= 0.1;
}
export function pageNotes(p: Project, ranges: Range[], frames: FrameStats[]): CheckProblem[] {
  const frame = p.settings.frameRate.denominator / p.settings.frameRate.numerator,
    hold = Math.max(1, Math.round(0.5 / frame)),
    settled = Math.max(1, Math.round(0.3 / frame)),
    found: CheckProblem[] = [];
  for (const group of contiguous(frames, frame))
    for (let i = 1; i < group.length; i++) {
      if (changedShare(group[i - 1]!, group[i]!) < 0.05) continue;
      let end: number | undefined;
      for (let j = i; j < Math.min(group.length, i + 6); j++) {
        if (j + hold >= group.length) break;
        if (group.slice(j + 1, j + hold + 1).every((f) => changedShare(group[j]!, f) <= 0.05)) {
          end = j;
          break;
        }
      }
      if (end == null) continue;
      const before = group[i - 1]!,
        after = group[end]!,
        time = group[i]!.time,
        share = changedShare(before, after),
        old = screenAt(p, before.time),
        now = screenAt(p, time);
      const transition = p.videoTracks
        .filter((t) => !t.hidden)
        .some((t) =>
          t.transitions.some((v) => {
            const w = transitionWindow(t, v);
            return (
              w &&
              w.start - frame <= time &&
              w.end + frame >= time &&
              t.clips.some(
                (c) =>
                  [v.fromClipID, v.toClipID].includes(c.id) &&
                  p.media.some((m) => m.id === clipMediaID(c) && m.role === "screen"),
              )
            );
          }),
        );
      if (
        (share >= 0.2 || (share >= 0.14 && meanChange(before, after) >= 4)) &&
        group
          .slice(Math.max(0, i - 1 - settled), i - 1)
          .every((f) => changedShare(f, before) <= 0.1) &&
        !isScroll(before.scanlines ?? [], after.scanlines ?? []) &&
        old &&
        now &&
        screenShows(p, before.time) &&
        screenShows(p, time) &&
        !transition &&
        ranges.some((r) => r.start <= time && time < r.end)
      )
        found.push({
          kind: "pageChange",
          start: time,
          end: after.time + frame,
          message: `Page change ${old.clip.id === now.clip.id ? "inside a clip" : "at a cut"}, with no transition: ${Math.round(share * 100)}% changes and then holds.`,
          clipIDs: [...new Set([old.clip.id, now.clip.id])],
        });
      i = end;
    }
  return found;
}
export function lowRateNotes(
  p: Project,
  ranges: Range[],
  frames: FrameStats[],
  times: ReadonlyMap<string, number[]>,
): CheckProblem[] {
  const fps = p.settings.frameRate.numerator / p.settings.frameRate.denominator,
    frame = 1 / fps,
    limit = Math.min(12, fps * 0.5),
    found: CheckProblem[] = [],
    changes: number[] = [],
    scanned: Range[] = [];
  for (const group of contiguous(frames, frame)) {
    scanned.push({ start: group[0]!.time, end: group.at(-1)!.time + frame });
    for (let i = 1; i < group.length; i++)
      if (changedShare(group[i - 1]!, group[i]!) > 0) changes.push(group[i]!.time);
  }
  for (const track of p.videoTracks.filter((candidate) => !candidate.hidden))
    for (const clip of track.clips.filter((c) => c.enabled && !c.freezeFrame)) {
      const id = clipMediaID(clip),
        source = id ? times.get(id) : undefined;
      if (!id || !source || !p.media.some((m) => m.id === id && m.role === "screen")) continue;
      const arrivals = source.map(
          (t) => clip.start.seconds + (t - clip.sourceStart.seconds) / clip.speed,
        ),
        clipEnd = clip.start.add(clip.duration).seconds;
      for (const range of ranges) {
        const start = Math.max(clip.start.seconds, range.start),
          end = Math.min(clipEnd, range.end);
        if (end - start < 1) continue;
        const flagged: { start: number; end: number; frames: number }[] = [];
        for (let slot = start; slot + 0.25 <= end + 1e-9; slot += 0.5) {
          const stop = Math.min(end, slot + 0.5),
            middle = (slot + stop) / 2,
            a = Math.max(clip.start.seconds, middle - 0.5),
            b = Math.min(clipEnd, middle + 0.5),
            rate = arrivals.filter((t) => t >= a && t < b).length / (b - a);
          if (
            b - a >= 0.5 &&
            rate < limit &&
            changes.filter((t) => t >= slot && t < stop).length >= 1.5 * (stop - slot) &&
            scanned.some((r) => r.start <= middle && r.end > middle) &&
            screenAt(p, middle)?.clip.id === clip.id &&
            screenShows(p, middle)
          )
            flagged.push({
              start: slot,
              end: stop,
              frames: arrivals.filter((t) => t >= slot && t < stop).length,
            });
        }
        for (let i = 0; i < flagged.length; i++) {
          let j = i;
          while (j + 1 < flagged.length && Math.abs(flagged[j + 1]!.start - flagged[j]!.end) < 1e-9)
            j++;
          const a = flagged[i]!.start,
            b = flagged[j]!.end;
          if (b - a >= 1 - 1e-9) {
            const rate = Math.max(
              1,
              Math.round(flagged.slice(i, j + 1).reduce((n, s) => n + s.frames, 0) / (b - a)),
            );
            found.push({
              kind: "lowFrameRate",
              start: a,
              end: b,
              message: `Low frame rate: the screen moves at about ${rate} fps against the project's ${fps} fps.`,
              clipIDs: [clip.id],
            });
          }
          i = j;
        }
      }
    }
  return found;
}
export function deadAirNotes(
  p: Project,
  ranges: Range[],
  frames: FrameStats[],
  transcripts: Transcripts,
  gaps: CheckProblem[],
): CheckProblem[] {
  const map = speechMap(p, transcripts),
    known = new Set(
      map.clips.filter((c) => !map.missing.includes(clipMediaID(c) ?? "")).map((c) => c.id),
    ),
    heard: Range[] = map.words.map((w) => ({ start: w.start, end: w.end })),
    frame = p.settings.frameRate.denominator / p.settings.frameRate.numerator;
  const solo = p.audioTracks.some((t) => t.solo && !t.muted);
  for (const t of p.audioTracks.filter(
    (candidate) => !candidate.muted && (!solo || candidate.solo),
  ))
    for (const c of t.clips.filter(
      (candidate) => candidate.enabled && !candidate.audio?.muted && !candidate.freezeFrame,
    )) {
      const media = p.media.find((m) => m.id === clipMediaID(c));
      if (!media?.hasAudio) continue;
      const start = c.start.seconds,
        end = c.start.add(c.duration).seconds;
      if (media.role === "music") {
        heard.push({
          start,
          end: Math.min(end, start + Math.max(1, Number(c.audio?.fadeIn ?? 0))),
        });
        const keys = c.keyframes["audio.gainDB"] ?? [];
        for (let i = 0; i + 1 < keys.length; i++) {
          const base = Number(keys[i]!.value);
          if (Number(keys[i + 1]!.value) <= base + 1) continue;
          let j = i + 1;
          while (j < keys.length && Number(keys[j]!.value) > base + 1) j++;
          heard.push({
            start: start + Number(keys[i]!.time),
            end: j < keys.length ? Math.min(end, start + Number(keys[j]!.time)) : end,
          });
          i = j;
        }
      } else if (!known.has(c.id)) heard.push({ start, end });
    }
  heard.push(
    ...gaps.map((g) => ({ start: g.start, end: g.end })),
    ...p.videoTracks
      .filter((t) => !t.hidden)
      .flatMap((t) =>
        t.clips
          .filter((c) => c.enabled && cardOf(c))
          .map((c) => ({ start: c.start.seconds, end: c.start.add(c.duration).seconds })),
      ),
  );
  const covered = unionRanges(heard),
    quiet: Range[] = [];
  for (const r of ranges) {
    let cursor = r.start;
    for (const h of covered.filter(
      (candidate) => candidate.end > r.start && candidate.start < r.end,
    )) {
      if (h.start > cursor) quiet.push({ start: cursor, end: h.start });
      cursor = Math.max(cursor, h.end);
    }
    if (cursor < r.end) quiet.push({ start: cursor, end: r.end });
  }
  const found: CheckProblem[] = [];
  const cameraMask = (time: number) =>
    Array.from({ length: 144 }, (_, tile) => {
      const row = Math.floor(tile / 16),
        col = tile % 16,
        x = (col + 0.5) / 16,
        y = (row + 0.5) / 9;
      let camera = false;
      for (const t of p.videoTracks.filter((candidate) => !candidate.hidden))
        for (const c of t.clips.filter((candidate) => active(candidate, time))) {
          const b = box(c, time, p);
          if (b && x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)
            camera = p.media.some((m) => m.id === clipMediaID(c) && m.role === "camera");
        }
      return camera;
    });
  const edge = (tile: number) =>
    Math.floor(tile / 16) === 0 ||
    Math.floor(tile / 16) === 8 ||
    tile % 16 === 0 ||
    tile % 16 === 15;
  for (const q of quiet.filter((candidate) => candidate.end - candidate.start >= 0.8))
    for (const group of contiguous(
      frames.filter((f) => f.time > q.start - frame && f.time < q.end),
      frame,
    )) {
      const masks = group.map((f) => cameraMask(f.time)),
        moving = group.map(() => false),
        busy = group.map(() => false);
      const changed = (i: number, j: number, threshold: number) =>
        group[i]!.thumbnail.reduce(
          (n, v, k) =>
            n +
            (!edge(k) &&
            !(masks[i]![k] && masks[j]![k]) &&
            Math.abs(v - group[j]!.thumbnail[k]!) > threshold
              ? 1
              : 0),
          0,
        );
      for (let i = 1; i < group.length; i++) {
        moving[i] = changed(i, i - 1, 2) > 0;
        busy[i] = changed(i, i - 1, 6) >= 5;
      }
      const animated = moving.map(
        (v, i) => v || (i > 0 && i + 1 < moving.length && moving[i - 1] && moving[i + 1]),
      );
      for (let i = 0; i < animated.length; i++) {
        if (!animated[i]) continue;
        let j = i;
        while (j < animated.length && animated[j]) j++;
        if (j - i >= 4) for (let k = i; k < j; k++) busy[k] = true;
        i = j;
      }
      let start = 0;
      const note = (a: number, b: number) => {
        const low = Math.max(q.start, group[a]!.time),
          high = Math.min(q.end, group[b]!.time + frame);
        if (high - low >= 0.8 - 1e-9)
          found.push({
            kind: "deadAir",
            start: low,
            end: high,
            message: `Dead air: ${(high - low).toFixed(3)}s with no speech, sound effect or music swell, and a still picture.`,
            clipIDs: p.videoTracks
              .filter((t) => !t.hidden)
              .flatMap((t) => t.clips.filter((c) => active(c, low)).map((c) => c.id))
              .reverse(),
          });
      };
      for (let i = 1; i < group.length; i++)
        if (busy[i] || changed(i, start, 6) >= 5) {
          note(start, i - 1);
          start = i;
        }
      if (group.length) note(start, group.length - 1);
    }
  return found;
}
