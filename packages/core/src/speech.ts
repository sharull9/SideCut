// Ported from TandemAPI/TranscriptTools.swift, TandemAPI/Captions.swift,
// TandemAPI/TandemService.swift and TandemMedia/TranscriptAlignment.swift.
// See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, MediaItem, Project, ProjectFile, Track } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { Time, flicksPerFrame, type FrameRate } from "@sidecut/contracts/time";
import { ProjectCoordinator } from "./coordinator";
import { projectDuration } from "./render-plan";
import { placeWords, type Transcript, type TranscriptWord } from "./transcript";

export const DEFAULT_PAUSE_MINIMUM = 0.6;
export const DEFAULT_PAUSE_KEEP = 0.15;
export const DEFAULT_SENTENCE_MINIMUM = 0.5;
export const DEFAULT_MID_MINIMUM = 0.5;
const WIDEN_GUARD = 0.04;

export type Transcripts = (item: MediaItem) => Transcript | undefined;
export interface Range {
  start: number;
  end: number;
}
export interface SpokenWord {
  text: string;
  start: number;
  end: number;
  clipID: string;
  mediaID: string;
}
export interface SpeechMap {
  words: SpokenWord[];
  covered: Range[];
  unknown: Range[];
  missing: string[];
  clips: Clip[];
}
export interface Pause {
  start: number;
  end: number;
  duration: number;
  before: string;
  after: string;
  clipIDs: string[];
}
export type PauseKind = "sentence" | "comma" | "mid";

// Times compare at Tandem's audio-sample precision, so float noise cannot move a threshold.
const samples = (seconds: number) => Math.round(seconds * 48_000);
const flicks = (seconds: number) => Time.fromSeconds(seconds).flicks;
const seconds = (value: bigint) => new Time(value).seconds;
const clipEnd = (clip: Clip) => clip.start.seconds + clip.duration.seconds;
const sourceEnd = (clip: Clip) => clip.sourceStart.seconds + clip.duration.seconds * clip.speed;
export function mediaIDOf(clip: Clip): string | null {
  const media = clip.content.media as { mediaID?: unknown } | undefined;
  return typeof media?.mediaID === "string" ? media.mediaID : null;
}
const isHeard = (clip: Clip) =>
  clip.enabled && clip.audio?.muted !== true && !clip.freezeFrame && mediaIDOf(clip) != null;
const allTracks = (project: Project) => [...project.videoTracks, ...project.audioTracks];

export function unionRanges(ranges: readonly Range[]): Range[] {
  const result: Range[] = [];
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && samples(range.start) <= samples(last.end)) last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

/** Unmuted audio tracks that ripple as the take (cut), else every unmuted audio track. */
export function speechTracks(project: Project): Track[] {
  const audio = project.audioTracks.filter((track) => !track.muted);
  const take = audio.filter((track) => track.rippleMode === "cut");
  return take.length ? take : audio;
}

export function speechMap(project: Project, transcripts: Transcripts): SpeechMap {
  const words: SpokenWord[] = [],
    covered: Range[] = [],
    unknown: Range[] = [],
    missing = new Set<string>(),
    clips: Clip[] = [];
  const cache = new Map<string, Transcript | undefined>();
  for (const track of speechTracks(project)) {
    // Each file's words are placed among all of its clips on the track at once.
    const byMedia = new Map<string, Clip[]>();
    for (const clip of track.clips.filter(isHeard)) {
      const mediaID = mediaIDOf(clip)!;
      if (!project.media.some((item) => item.id === mediaID)) continue;
      clips.push(clip);
      byMedia.set(mediaID, [...(byMedia.get(mediaID) ?? []), clip]);
    }
    for (const [mediaID, group] of byMedia) {
      const item = project.media.find((m) => m.id === mediaID)!;
      if (!cache.has(mediaID)) cache.set(mediaID, transcripts(item));
      const transcript = cache.get(mediaID);
      const ranges = group.map((clip) => ({ start: clip.start.seconds, end: clipEnd(clip) }));
      if (!transcript) {
        missing.add(mediaID);
        unknown.push(...ranges);
        continue;
      }
      covered.push(...ranges);
      words.push(
        ...placeWords(transcript, group).map((word) => ({
          text: word.text,
          start: word.start,
          end: word.end,
          clipID: word.clipID,
          mediaID,
        })),
      );
    }
  }
  words.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    words,
    covered: unionRanges(covered),
    unknown: unionRanges(unknown),
    missing: [...missing].sort(),
    clips,
  };
}

const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;
const context = (words: readonly SpokenWord[], from: number, to: number) =>
  words
    .slice(Math.max(0, from), Math.min(words.length, to))
    .map((w) => w.text)
    .join(" ");

/** Silences between words, only where transcribed speech clips cover the whole gap. */
export function findPauses(map: SpeechMap, minimum: number, from?: number, to?: number): Pause[] {
  const result: Pause[] = [];
  let lastEnd: number | undefined;
  map.words.forEach((word, index) => {
    const previousEnd = lastEnd;
    lastEnd = Math.max(lastEnd ?? word.end, word.end);
    if (previousEnd === undefined || samples(word.start - previousEnd) < samples(minimum)) return;
    const gap = { start: previousEnd, end: word.start };
    if (from !== undefined && samples(gap.start) < samples(from)) return;
    if (to !== undefined && samples(gap.end) > samples(to)) return;
    const inside = map.covered.some(
      (range) =>
        samples(range.start) <= samples(gap.start) && samples(gap.end) <= samples(range.end),
    );
    if (!inside || map.unknown.some((range) => overlaps(range, gap))) return;
    result.push({
      ...gap,
      duration: gap.end - gap.start,
      before: context(map.words, index - 4, index),
      after: context(map.words, index, index + 4),
      clipIDs: map.clips
        .filter((clip) => overlaps({ start: clip.start.seconds, end: clipEnd(clip) }, gap))
        .map((clip) => clip.id),
    });
  });
  return result;
}

// MARK: Search

/** Lower-case words with apostrophes and punctuation removed, so "Don't," matches "dont". */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Word-index ranges [first, last] where the phrase occurs. */
export function phraseMatches(phrase: string, transcript: Transcript): [number, number][] {
  const wanted = tokens(phrase);
  if (!wanted.length) return [];
  const stream = transcript.words.flatMap((word, index) =>
    tokens(word.text).map((token) => ({ token, index })),
  );
  const result: [number, number][] = [];
  let i = 0;
  while (i <= stream.length - wanted.length) {
    if (wanted.every((token, k) => stream[i + k]!.token === token)) {
      const range: [number, number] = [stream[i]!.index, stream[i + wanted.length - 1]!.index];
      const last = result.at(-1);
      if (!last || last[0] !== range[0] || last[1] !== range[1]) result.push(range);
      i += wanted.length;
    } else i++;
  }
  return result;
}

export interface SearchHit {
  text: string;
  start: number;
  end: number;
  clipIDs: string[];
  mediaID: string;
  mediaStart: number;
  mediaEnd: number;
  partial: boolean;
  before: string;
  after: string;
}
export interface UnusedHit {
  mediaID: string;
  path: string;
  text: string;
  mediaStart: number;
  mediaEnd: number;
  before: string;
  after: string;
}
export interface SearchResult {
  revision: number;
  phrase: string;
  hits: SearchHit[];
  unused: UnusedHit[];
  missing: string[];
}

/** The `search` service query: timeline hits by clip, and matches in unused source material. */
export function searchSpeech(
  file: Pick<ProjectFile, "project" | "revision">,
  phrase: string,
  transcripts: Transcripts,
  limit?: number,
): SearchResult {
  if (!tokens(phrase).length) throw new Error("Search for at least one word.");
  const project = file.project;
  const hits: SearchHit[] = [],
    unused: UnusedHit[] = [],
    missing: string[] = [];
  const speechMedia = new Set(
    speechTracks(project).flatMap((track) => track.clips.map(mediaIDOf).filter((id) => id != null)),
  );
  for (const item of project.media.filter((m) => m.hasAudio)) {
    const transcript = transcripts(item);
    if (!transcript) {
      if (speechMedia.has(item.id)) missing.push(item.id);
      continue;
    }
    const found = phraseMatches(phrase, transcript);
    if (!found.length) continue;
    // Where each word plays, track by track, by the same placement rule as the transcript lane.
    const placed = new Map<number, { clipID: string; start: number; end: number }[]>();
    const rank = new Map<string, number>();
    for (const track of allTracks(project)) {
      const clips = track.clips.filter((clip) => mediaIDOf(clip) === item.id);
      for (const clip of clips) rank.set(clip.id, rank.size);
      for (const word of placeWords(transcript, clips, { includeDisabled: true }))
        placed.set(word.index, [...(placed.get(word.index) ?? []), word]);
    }
    const words = transcript.words;
    for (const [first, last] of found) {
      const text = words
        .slice(first, last + 1)
        .map((w) => w.text)
        .join(" ");
      const before = words
        .slice(Math.max(0, first - 4), first)
        .map((w) => w.text)
        .join(" ");
      const after = words
        .slice(last + 1, last + 5)
        .map((w) => w.text)
        .join(" ");
      const mediaStart = words[first]!.start,
        mediaEnd = words[last]!.end;
      const byClip = new Map<string, { start: number; end: number; count: number }>();
      for (let index = first; index <= last; index++)
        for (const word of placed.get(index) ?? []) {
          const entry = byClip.get(word.clipID);
          byClip.set(
            word.clipID,
            entry
              ? {
                  start: Math.min(entry.start, word.start),
                  end: Math.max(entry.end, word.end),
                  count: entry.count + 1,
                }
              : { start: word.start, end: word.end, count: 1 },
          );
        }
      if (!byClip.size)
        unused.push({
          mediaID: item.id,
          path: item.path,
          text,
          mediaStart,
          mediaEnd,
          before,
          after,
        });
      const byRange = new Map<string, SearchHit>();
      for (const clipID of [...byClip.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!)) {
        const entry = byClip.get(clipID)!;
        const key = `${samples(entry.start)}:${samples(entry.end)}`;
        const hit = byRange.get(key) ?? {
          text,
          start: entry.start,
          end: entry.end,
          clipIDs: [],
          mediaID: item.id,
          mediaStart,
          mediaEnd,
          partial: false,
          before,
          after,
        };
        hit.clipIDs.push(clipID);
        hit.partial ||= entry.count < last - first + 1;
        byRange.set(key, hit);
      }
      hits.push(...byRange.values());
    }
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  unused.sort((a, b) =>
    a.mediaID < b.mediaID ? -1 : a.mediaID > b.mediaID ? 1 : a.mediaStart - b.mediaStart,
  );
  const cap = limit !== undefined && limit >= 0 ? limit : Infinity;
  return {
    revision: file.revision,
    phrase,
    hits: hits.slice(0, cap),
    unused: unused.slice(0, cap),
    missing: missing.sort(),
  };
}

// MARK: Word bounds against waveform activity (TranscriptAlignment version 1)

export const ALIGNMENT_VERSION = 1;
const MIN_SILENCE = 0.1,
  FLICKER = 0.02,
  MIN_VOICE = 0.04,
  MIN_OVERLAP = 0.06,
  SENTENCE_LEAN = 0.2,
  MIN_WORD = 0.05,
  REACH = 1,
  MIN_RATE = 50;
interface Run {
  start: number;
  end: number;
}

/** Pulls transcript word edges in to the voice using peaks (loudest sample per bin). */
export function alignWords(
  words: readonly TranscriptWord[],
  peaks: ArrayLike<number>,
  peaksPerSecond: number,
  origin = 0,
): TranscriptWord[] {
  if (!words.length || peaksPerSecond < MIN_RATE || peaks.length < 20) return [...words];
  const levels = Array.from(peaks, (peak) => (peak > 0 ? 20 * Math.log10(peak) : -120));
  const runs = voicedRuns(levels, peaksPerSecond, threshold(levels), origin);
  if (!runs.length) return [...words];
  return placeInRuns(words, runs, assignRuns(words, runs));
}
export function alignTranscript(
  transcript: Transcript,
  peaks: ArrayLike<number>,
  peaksPerSecond: number,
): Transcript {
  return { ...transcript, words: alignWords(transcript.words, peaks, peaksPerSecond) };
}

function threshold(levels: readonly number[]) {
  const sorted = levels.toSorted((a, b) => a - b);
  if (!sorted.length) return -120;
  const floor = sorted[Math.floor(sorted.length / 10)]!;
  const loud = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * 9) / 10))]!;
  return Math.max(floor + 10, loud - 30);
}

function voicedRuns(levels: readonly number[], rate: number, limit: number, origin: number): Run[] {
  // Swift's rounded() rounds halves away from zero; bucket counts are positive.
  const buckets = (s: number) => Math.max(1, Math.round(s * rate));
  const spans: { start: number; end: number }[] = [];
  let index = 0;
  while (index < levels.length) {
    if (!(levels[index]! > limit)) {
      index++;
      continue;
    }
    let end = index;
    while (end < levels.length && levels[end]! > limit) end++;
    const last = spans.at(-1);
    if (last && index - last.end <= buckets(FLICKER)) last.end = end;
    else spans.push({ start: index, end });
    index = end;
  }
  const runs: { start: number; end: number }[] = [];
  for (const span of spans.filter((s) => s.end - s.start >= buckets(MIN_VOICE))) {
    const last = runs.at(-1);
    if (last && span.start - last.end < buckets(MIN_SILENCE)) last.end = span.end;
    else runs.push({ ...span });
  }
  return runs.map((r) => ({ start: origin + r.start / rate, end: origin + r.end / rate }));
}

const endsClause = (text: string) => /[.?!,;:…]$/.test(text.trimEnd());
function upperBound(values: readonly number[], value: number) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function assignRuns(words: readonly TranscriptWord[], runs: readonly Run[]): (number | null)[] {
  const starts = runs.map((r) => r.start);
  const options = words.map((word) => {
    const start = word.start,
      end = Math.max(word.end, start + 0.01);
    const overlapping: { run: number; cost: number }[] = [];
    let index = Math.max(0, upperBound(starts, start) - 1);
    while (index < runs.length && runs[index]!.start < end) {
      const overlap = Math.min(end, runs[index]!.end) - Math.max(start, runs[index]!.start);
      if (overlap > 0) overlapping.push({ run: index, cost: -overlap });
      index++;
    }
    if (overlapping.length) {
      const real = overlapping.filter((o) => -o.cost >= MIN_OVERLAP);
      return real.length
        ? real
        : [overlapping.reduce((best, o) => (o.cost < best.cost ? o : best))];
    }
    // No voice under it at all: the nearest runs within reach.
    const near: { run: number; cost: number }[] = [];
    const after = upperBound(starts, start);
    if (after < runs.length && runs[after]!.start - end <= REACH)
      near.push({ run: after, cost: runs[after]!.start - end });
    if (after > 0 && start - runs[after - 1]!.end <= REACH)
      near.push({ run: after - 1, cost: start - runs[after - 1]!.end });
    return near;
  });
  const best: Map<number, { cost: number; previous: number | null }>[] = [];
  const aligned: number[] = [];
  options.forEach((choices, index) => {
    if (!choices.length) return;
    const row = new Map<number, { cost: number; previous: number | null }>();
    const before = best.at(-1),
      previousWord = aligned.at(-1);
    if (before && previousWord !== undefined) {
      const lean =
        previousWord === index - 1 && endsClause(words[previousWord]!.text) && choices.length > 1;
      for (const choice of choices) {
        let pick: { cost: number; previous: number | null } | undefined;
        for (const [run, entry] of before) {
          if (run > choice.run) continue;
          const cost = entry.cost + choice.cost + (lean && run === choice.run ? SENTENCE_LEAN : 0);
          if (!pick || cost < pick.cost) pick = { cost, previous: run };
        }
        if (pick) row.set(choice.run, pick);
      }
      // Every run it could go to is behind the previous word: it joins that word's run.
      if (!row.size)
        for (const [run, entry] of before) row.set(run, { cost: entry.cost + 1, previous: run });
    } else for (const choice of choices) row.set(choice.run, { cost: choice.cost, previous: null });
    best.push(row);
    aligned.push(index);
  });
  const result: (number | null)[] = words.map(() => null);
  const last = best.at(-1);
  if (!last) return result;
  let run = [...last].reduce((a, b) =>
    b[1].cost < a[1].cost || (b[1].cost === a[1].cost && b[0] < a[0]) ? b : a,
  )[0];
  for (let k = aligned.length - 1; k >= 0; k--) {
    result[aligned[k]!] = run;
    const previous = best[k]!.get(run)?.previous;
    if (previous != null) run = previous;
  }
  return result;
}

function placeInRuns(
  words: readonly TranscriptWord[],
  runs: readonly Run[],
  assignment: readonly (number | null)[],
): TranscriptWord[] {
  const out = words.map((w) => ({ ...w }));
  let index = 0;
  while (index < words.length) {
    const run = assignment[index];
    if (run == null) {
      index++;
      continue;
    }
    const members = [index];
    let next = index + 1;
    while (next < words.length && (assignment[next] == null || assignment[next] === run)) {
      if (assignment[next] === run) members.push(next);
      next++;
    }
    const span = runs[run]!;
    const bounds = [span.start];
    for (let k = 1; k < members.length; k++) {
      const between = (words[members[k - 1]!]!.end + words[members[k]!]!.start) / 2;
      bounds.push(Math.min(Math.max(between, bounds.at(-1)!), span.end));
    }
    bounds.push(span.end);
    const count = members.length;
    if (span.end - span.start < count * MIN_WORD) {
      const letters = members.map((m) =>
        Math.max(1, words[m]!.text.replace(/[^\p{L}\p{N}]/gu, "").length),
      );
      const total = letters.reduce((a, b) => a + b, 0);
      let at = span.start;
      letters.forEach((share, offset) => {
        at += ((span.end - span.start) * share) / total;
        bounds[offset + 1] = offset + 1 === count ? span.end : at;
      });
    } else {
      for (let k = 1; k < count; k++) bounds[k] = Math.max(bounds[k]!, bounds[k - 1]! + MIN_WORD);
      for (let k = count - 1; k >= 1; k--)
        bounds[k] = Math.min(bounds[k]!, bounds[k + 1]! - MIN_WORD);
    }
    members.forEach((member, offset) => {
      out[member]!.start = bounds[offset]!;
      out[member]!.end = bounds[offset + 1]!;
    });
    index = next;
  }
  // Words that kept their own times must not overlap their neighbours.
  for (let k = 1; k < out.length; k++) {
    if (out[k]!.start < out[k - 1]!.end) out[k]!.start = out[k - 1]!.end;
    if (out[k]!.end < out[k]!.start) out[k]!.end = out[k]!.start;
  }
  return out;
}

// MARK: Tightening

export interface PauseRules {
  sentence: number | null;
  comma: number | null;
  mid: number | null;
  /** Sentence pauses at least this long change. */
  minimum: number;
  /** Comma and mid-sentence pauses at least this long change. */
  midMinimum: number;
}
/** The reference `mike` rules: 0.4 s between sentences, 0.12 s after commas, 0.08 s mid-sentence. */
export const REFERENCE_SPEECH_RULES: PauseRules = {
  sentence: 0.4,
  comma: 0.12,
  mid: 0.08,
  minimum: 0.5,
  midMinimum: 0.5,
};
const keepFor = (rules: PauseRules, kind: PauseKind) =>
  kind === "sentence" ? rules.sentence : kind === "comma" ? (rules.comma ?? rules.mid) : rules.mid;
const shortestFor = (rules: PauseRules, kind: PauseKind) =>
  kind === "sentence" ? rules.minimum : rules.midMinimum;

export function pauseKind(after: string): PauseKind {
  const trimmed = after.trim().replace(/["'”’)\]»]+$/u, "");
  const last = trimmed.at(-1);
  if (!last) return "mid";
  if (".?!…".includes(last)) return "sentence";
  if (",;:".includes(last)) return "comma";
  return "mid";
}
export const isProtected = (pause: Pause, times: readonly number[]) =>
  times.some((t) => samples(pause.start) <= samples(t) && samples(t) <= samples(pause.end));

const ceilToFrame = (value: bigint, frame: bigint) =>
  value >= 0n ? ((value + frame - 1n) / frame) * frame : -(-value / frame) * frame;
const floorToFrame = (value: bigint, frame: bigint) =>
  value >= 0n ? (value / frame) * frame : -((-value + frame - 1n) / frame) * frame;
const roundToFrame = (value: bigint, rate: FrameRate) =>
  new Time(value).roundedToFrame(rate).flicks;

export interface PlannedCut {
  pause: Pause;
  /** The frame-aligned time `rippleDeleteRange` removes. */
  cut: Range;
  kind: PauseKind | null;
  keep: number | null;
}
export function planCuts(
  pauses: readonly Pause[],
  rules: PauseRules,
  rate: FrameRate,
  snug: boolean,
): PlannedCut[] {
  const frame = flicksPerFrame(rate);
  return pauses.flatMap((pause) => {
    const kind = pauseKind(pause.before);
    const keep = keepFor(rules, kind);
    if (keep == null || samples(pause.duration) < samples(shortestFor(rules, kind))) return [];
    const start = flicks(pause.start),
      end = flicks(pause.end),
      kept = flicks(keep);
    let cut: { start: bigint; end: bigint };
    if (snug) {
      // As long as whole frames allow and centred, so the kept silence is within a frame of keep.
      const length = ((end - start - kept) / frame) * frame;
      if (length < frame) return [];
      const centred = roundToFrame(start + (end - start - length) / 2n, rate);
      const latest = floorToFrame(end - length, frame),
        earliest = ceilToFrame(start, frame);
      const at = centred < latest ? centred : latest;
      cut = { start: at > earliest ? at : earliest, end: 0n };
      cut.end = cut.start + length;
    } else {
      const half = kept / 2n;
      cut = {
        start: ceilToFrame(start + half, frame),
        end: floorToFrame(end - (kept - half), frame),
      };
      if (cut.end - cut.start < frame) return [];
    }
    return [{ pause, cut: { start: seconds(cut.start), end: seconds(cut.end) }, kind, keep }];
  });
}

export interface PlannedWiden {
  pause: Pause;
  kind: PauseKind;
  keep: number;
  at: number;
  clipID: string;
  nextClipID: string;
  tail: number;
  head: number;
}

const sourceLimit = (project: Project, clip: Clip) => {
  const item = project.media.find((m) => m.id === mediaIDOf(clip));
  return item && item.kind !== "image" ? item.duration?.seconds : undefined;
};
const trackOf = (project: Project, clipID: string) =>
  allTracks(project).find((track) => track.clips.some((clip) => clip.id === clipID));
const linked = (project: Project, clip: Clip) =>
  clip.linkGroup == null
    ? [clip]
    : allTracks(project).flatMap((t) => t.clips.filter((c) => c.linkGroup === clip.linkGroup));

/** Joins that leave less silence than their keep, widened back from silence in the take either side. */
export function planWidening(
  map: SpeechMap,
  project: Project,
  rules: PauseRules,
  transcripts: Transcripts,
  protect: readonly number[] = [],
  from?: number,
  to?: number,
): PlannedWiden[] {
  const rate = project.settings.frameRate,
    frame = seconds(flicksPerFrame(rate));
  const clips = new Map(map.clips.map((clip) => [clip.id, clip]));
  const result: PlannedWiden[] = [];
  const frames = (time: number) => (time > 0 ? Number(flicks(time) / flicksPerFrame(rate)) : 0);
  for (let index = 1; index < map.words.length; index++) {
    const before = map.words[index - 1]!,
      after = map.words[index]!;
    const left = clips.get(before.clipID),
      right = clips.get(after.clipID);
    if (before.clipID === after.clipID || samples(after.start) < samples(before.end)) continue;
    if (!left || !right) continue;
    const mediaID = mediaIDOf(left);
    if (!mediaID || mediaIDOf(right) !== mediaID) continue;
    if (trackOf(project, left.id) !== trackOf(project, right.id)) continue;
    if (Math.abs(right.start.seconds - clipEnd(left)) > frame / 2) continue;
    const item = project.media.find((m) => m.id === mediaID);
    const words = item ? transcripts(item)?.words : undefined;
    if (!words) continue;
    // A through-edit: the take carries straight on, so the gap is as spoken.
    if (
      left.speed === right.speed &&
      Math.abs(right.sourceStart.seconds - sourceEnd(left)) <= frame
    )
      continue;
    const gap = { start: before.end, end: after.start };
    if (from !== undefined && samples(gap.start) < samples(from)) continue;
    if (to !== undefined && samples(gap.end) > samples(to)) continue;
    const pause: Pause = {
      ...gap,
      duration: gap.end - gap.start,
      before: context(map.words, index - 4, index),
      after: context(map.words, index, index + 4),
      clipIDs: [left.id, right.id],
    };
    const kind = pauseKind(pause.before),
      keep = keepFor(rules, kind);
    if (isProtected(pause, protect) || keep == null) continue;
    const wanted = Math.round((keep - pause.duration) / frame);
    if (wanted <= 0) continue;
    let tailRoom = 0;
    const end = sourceEnd(left);
    if (!words.some((w) => w.start < end && w.end > end)) {
      const next =
        words
          .filter((w) => w.start >= end)
          .reduce<number | undefined>(
            (min, w) => (min === undefined || w.start < min ? w.start : min),
            undefined,
          ) ?? sourceLimit(project, left);
      if (next !== undefined) tailRoom = (next - end) / left.speed - WIDEN_GUARD;
    }
    let headRoom = 0;
    const start = right.sourceStart.seconds;
    if (!words.some((w) => w.start < start && w.end > start)) {
      const previous = words
        .filter((w) => w.end <= start)
        .reduce((max, w) => Math.max(max, w.end), 0);
      headRoom = (start - previous) / right.speed - WIDEN_GUARD;
    }
    // Linked camera and screen clips stretch too, so their files need the room as well.
    for (const clip of linked(project, left)) {
      const limit = sourceLimit(project, clip);
      if (mediaIDOf(clip) == null || clip.holdEdges === true || limit === undefined) continue;
      tailRoom = Math.min(tailRoom, (limit - sourceEnd(clip)) / clip.speed);
    }
    for (const clip of linked(project, right)) {
      if (mediaIDOf(clip) == null || clip.holdEdges === true) continue;
      headRoom = Math.min(headRoom, clip.sourceStart.seconds / clip.speed);
    }
    const tailFrames = frames(tailRoom),
      headFrames = frames(headRoom);
    let tail = Math.min(tailFrames, Math.floor((wanted + 1) / 2));
    const head = Math.min(headFrames, wanted - tail);
    tail = Math.min(tailFrames, wanted - head);
    if (tail + head <= 0) continue;
    result.push({
      pause,
      kind,
      keep,
      at: right.start.seconds,
      clipID: left.id,
      nextClipID: right.id,
      tail: Time.frames(BigInt(tail), rate).seconds,
      head: Time.frames(BigInt(head), rate).seconds,
    });
  }
  return result;
}

/** Cuts and widening trims as one batch, latest first, so every time is still current when it runs. */
export function tightenCommands(
  cuts: readonly PlannedCut[],
  widening: readonly PlannedWiden[] = [],
): EditCommand[] {
  const steps: { time: number; commands: EditCommand[] }[] = cuts.map((cut) => ({
    time: cut.cut.start,
    commands: [
      {
        rippleDeleteRange: {
          range: { start: cut.cut.start, duration: cut.cut.end - cut.cut.start },
        },
      } as unknown as EditCommand,
    ],
  }));
  for (const widen of widening) {
    const commands: EditCommand[] = [];
    // The rippled head trim keeps the later clip's start, so the tail trim still finds the join.
    if (widen.head > 0)
      commands.push({
        trim: {
          clipID: widen.nextClipID,
          edge: "start",
          to: widen.at - widen.head,
          ripple: true,
        },
      } as unknown as EditCommand);
    if (widen.tail > 0)
      commands.push({
        trim: {
          clipID: widen.clipID,
          edge: "end",
          to: widen.at + widen.tail,
          ripple: true,
        },
      } as unknown as EditCommand);
    steps.push({ time: widen.at, commands });
  }
  return steps.toSorted((a, b) => b.time - a.time).flatMap((step) => step.commands);
}

export interface TightenRequest {
  min?: number | null;
  keep?: number | null;
  sentence?: number | null;
  comma?: number | null;
  mid?: number | null;
  midMin?: number | null;
  mike?: boolean | null;
  protect?: readonly number[] | null;
  widen?: boolean | null;
  from?: number | null;
  to?: number | null;
  label?: string | null;
  author?: string | null;
}
export interface TightenPlan {
  revision: number;
  minimum: number;
  keep: number;
  sentence: number | null;
  comma: number | null;
  mid: number | null;
  midMinimum: number | null;
  cuts: PlannedCut[];
  widened: PlannedWiden[];
  protected: Pause[];
  removed: number;
  added: number;
  durationBefore: number;
  durationAfter: number;
  commands: EditCommand[];
  label: string;
  warnings: string[];
  missing: string[];
  /** Set when locked take tracks would put the take out of sync; applying must refuse. */
  locked: string | null;
}

const bySentence = (r: TightenRequest) =>
  r.sentence != null || r.comma != null || r.mid != null || r.mike === true;

export function pauseRules(request: TightenRequest): PauseRules {
  if (!bySentence(request)) {
    if (request.midMin != null)
      throw new Error(
        "`midMin` is for comma and mid-sentence pauses; give `mid` or `comma` (or `mike`) with it.",
      );
    const minimum = request.min ?? DEFAULT_PAUSE_MINIMUM,
      keep = request.keep ?? DEFAULT_PAUSE_KEEP;
    if (!(minimum > 0)) throw new Error("`min` must be more than 0 seconds.");
    if (!(keep >= 0 && keep < minimum))
      throw new Error(`\`keep\` (${keep} s) must be shorter than \`min\` (${minimum} s).`);
    return { sentence: keep, comma: keep, mid: keep, minimum, midMinimum: minimum };
  }
  if (request.keep != null)
    throw new Error(
      "`keep` is one keep for every pause. With `sentence`, `comma`, `mid` or `mike`, give each kind its own instead.",
    );
  const preset = request.mike === true ? REFERENCE_SPEECH_RULES : null;
  const rules: PauseRules = {
    sentence: request.sentence ?? preset?.sentence ?? null,
    comma: request.comma ?? preset?.comma ?? null,
    mid: request.mid ?? preset?.mid ?? null,
    minimum: request.min ?? preset?.minimum ?? DEFAULT_SENTENCE_MINIMUM,
    midMinimum: request.midMin ?? preset?.midMinimum ?? DEFAULT_MID_MINIMUM,
  };
  for (const name of ["sentence", "comma", "mid"] as const)
    if (rules[name] != null && rules[name] < 0)
      throw new Error(`\`${name}\` can't be less than 0 seconds.`);
  if (!(rules.minimum > 0)) throw new Error("`min` must be more than 0 seconds.");
  if (!(rules.midMinimum > 0)) throw new Error("`midMin` must be more than 0 seconds.");
  return rules;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const duration = (s: number) => `${Number(s.toFixed(3))} s`;

/**
 * The `tighten` dry run: the cuts, widening trims, their batch, and the duration
 * the batch produces when checked on a copy of the project.
 */
export function planTighten(
  file: Pick<ProjectFile, "project" | "revision">,
  request: TightenRequest,
  transcripts: Transcripts,
): TightenPlan {
  const rules = pauseRules(request);
  const project = file.project;
  const map = speechMap(project, transcripts);
  const protect = request.protect ?? [];
  const from = request.from ?? undefined,
    to = request.to ?? undefined;
  const found = findPauses(map, Math.min(rules.minimum, rules.midMinimum), from, to);
  const cuts = planCuts(
    found.filter((p) => !isProtected(p, protect)),
    rules,
    project.settings.frameRate,
    bySentence(request),
  );
  const widened =
    request.widen === true ? planWidening(map, project, rules, transcripts, protect, from, to) : [];
  const commands = tightenCommands(cuts, widened);
  const removed = cuts.reduce((sum, c) => sum + (c.cut.end - c.cut.start), 0);
  const added = widened.reduce((sum, w) => sum + w.tail + w.head, 0);
  const warnings: string[] = [];
  if (map.missing.length)
    warnings.push(
      `No transcript yet for ${map.missing
        .map((id) => project.media.find((m) => m.id === id)?.path ?? id)
        .join(", ")}, so pauses there aren't included.`,
    );
  const lockedNames = allTracks(project)
    .filter((t) => t.rippleMode === "cut" && t.locked)
    .map((t) => `"${t.name}"`);
  const locked =
    lockedNames.length && commands.length
      ? `Track ${lockedNames.join(", ")} is locked, so tightening would put the take out of sync. Unlock it first.`
      : null;
  if (locked) warnings.push(locked);
  const sentenceMode = bySentence(request);
  const before = projectDuration(project).seconds;
  const plan: TightenPlan = {
    revision: file.revision,
    minimum: rules.minimum,
    keep: rules.sentence ?? rules.comma ?? rules.mid ?? 0,
    sentence: sentenceMode ? rules.sentence : null,
    comma: sentenceMode ? rules.comma : null,
    mid: sentenceMode ? rules.mid : null,
    midMinimum: sentenceMode ? rules.midMinimum : null,
    cuts,
    widened,
    protected: found.filter((p) => isProtected(p, protect)),
    removed,
    added,
    durationBefore: before,
    durationAfter: before - removed + added,
    commands,
    label: "",
    warnings,
    missing: map.missing,
    locked,
  };
  plan.label = request.label ?? tightenLabel(plan);
  if (!commands.length) return plan;
  // Dry run on a scratch coordinator: same validation and warnings as the real apply.
  const scratch = new ProjectCoordinator({ revision: file.revision, project });
  const result = scratch.apply({ label: plan.label, commands, expectedRevision: file.revision });
  plan.durationAfter = projectDuration(scratch.getSnapshot().project).seconds;
  plan.warnings.push(...result.warnings);
  return plan;
}

function tightenLabel(plan: TightenPlan): string {
  const cuts = plan.cuts.length,
    widened = plan.widened.length;
  if (plan.sentence == null && plan.comma == null && plan.mid == null)
    return `Tighten ${plural(cuts, "pause")} to ${duration(plan.keep)}${widened ? `, widen ${plural(widened, "join")}` : ""}`;
  const parts: string[] = [];
  if (cuts) parts.push(`Tighten ${plural(cuts, "pause")}`);
  if (widened) parts.push(`${parts.length ? "widen" : "Widen"} ${plural(widened, "join")}`);
  const keeps = (["sentence", "comma", "mid"] as const)
    .filter((k) => plan[k] != null)
    .map((k) => `${k} ${duration(plan[k]!)}`)
    .join(", ");
  return `${parts.join(", ")}: ${keeps}`;
}

// MARK: Captions

export interface PlannedCaption {
  start: number;
  end: number;
  text: string;
  words: SpokenWord[];
}
/** Groups spoken words into captions of at most `maxWords`, breaking at sentences, gaps and length. */
export function groupCaptions(
  words: readonly SpokenWord[],
  maxWords: number,
  rate: FrameRate,
  maxGap = 0.35,
  maxDuration = 1.8,
  hold = 0.2,
): PlannedCaption[] {
  // Two voice tracks can play the same take; keep one copy of a word.
  const unique: SpokenWord[] = [];
  for (const word of words) {
    const last = unique.at(-1);
    if (last && samples(word.start) < samples(last.end) && word.text === last.text) continue;
    unique.push(word);
  }
  const groups: SpokenWord[][] = [];
  let current: SpokenWord[] = [];
  for (const word of unique) {
    const first = current[0],
      last = current.at(-1);
    if (first && last) {
      const sentenceEnded = /[.?!]$/.test(last.text);
      if (
        current.length >= maxWords ||
        samples(word.start - last.end) > samples(maxGap) ||
        samples(word.end - first.start) > samples(maxDuration) ||
        sentenceEnded
      ) {
        groups.push(current);
        current = [];
      }
    }
    current.push(word);
  }
  if (current.length) groups.push(current);
  const frame = flicksPerFrame(rate);
  const result: { start: bigint; end: bigint; words: SpokenWord[] }[] = [];
  groups.forEach((group, index) => {
    const start = floorToFrame(flicks(group[0]!.start), frame);
    let end = ceilToFrame(flicks(group.at(-1)!.end + hold), frame);
    const next = groups[index + 1];
    if (next) {
      const limit = floorToFrame(flicks(next[0]!.start), frame);
      if (limit < end) end = limit;
    }
    const previous = result.at(-1);
    if (previous && start < previous.end) previous.end = start;
    if (end - start < frame) return;
    result.push({ start, end, words: group });
  });
  return result
    .filter((caption) => caption.end - caption.start >= frame)
    .map((caption) => ({
      start: seconds(caption.start),
      end: seconds(caption.end),
      text: caption.words.map((w) => w.text).join(" "),
      words: caption.words,
    }));
}

export interface CaptionsRequest {
  from?: number | null;
  to?: number | null;
  words?: number | null;
  y?: number | null;
  track?: string | null;
  label?: string | null;
}
export interface CaptionsPlan {
  revision: number;
  track: string;
  captions: { start: number; end: number; text: string }[];
  commands: EditCommand[];
  label: string;
  warnings: string[];
  missing: string[];
}
const trackID = () =>
  `trk_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/** The `captions` dry run: caption text clips from the shared timeline-word query, as one batch. */
export function planCaptions(
  file: Pick<ProjectFile, "project" | "revision">,
  request: CaptionsRequest,
  transcripts: Transcripts,
  makeID: () => string = trackID,
): CaptionsPlan {
  const maxWords = request.words ?? 3;
  if (!Number.isInteger(maxWords) || maxWords < 1 || maxWords > 12)
    throw new Error("`words` must be between 1 and 12.");
  if (request.y != null && !(request.y >= 0 && request.y <= 1))
    throw new Error("`y` is a fraction of the frame height, from 0 (top) to 1 (bottom).");
  const name = request.track ?? "Captions";
  const project = file.project;
  const map = speechMap(project, transcripts);
  const words = map.words.filter(
    (w) =>
      (request.from == null || samples(w.start) >= samples(request.from)) &&
      (request.to == null || samples(w.end) <= samples(request.to)),
  );
  const planned = groupCaptions(words, maxWords, project.settings.frameRate);
  const commands: EditCommand[] = [];
  const existing = project.videoTracks.find((t) => t.name.toLowerCase() === name.toLowerCase());
  let id: string;
  if (existing) {
    if (existing.locked) throw new Error(`Track "${name}" is locked.`);
    id = existing.id;
  } else {
    id = makeID();
    commands.push({ addTrack: { kind: "video", name, id } } as EditCommand);
    // Captions move with the speech when pauses are tightened later.
    commands.push({ updateTrack: { trackID: id, patch: { rippleMode: "follow" } } } as EditCommand);
  }
  for (const caption of planned)
    commands.push({
      insertClip: {
        trackID: id,
        mode: "overwrite",
        clip: {
          name: caption.text,
          content: {
            text: {
              text: caption.text,
              preset: "caption",
              words: caption.words.map((w) => ({
                text: w.text,
                start: Math.max(0, Time.fromSeconds(w.start - caption.start).toJSON()),
                end: Math.max(0, Time.fromSeconds(w.end - caption.start).toJSON()),
              })),
            },
          },
          start: caption.start,
          duration: caption.end - caption.start,
          tags: ["captions"],
          ...(request.y != null
            ? { video: { transform: { position: { x: 0.5, y: request.y } } } }
            : {}),
        },
      },
    } as unknown as EditCommand);
  const warnings: string[] = [];
  if (map.missing.length)
    warnings.push(
      `No transcript yet for ${map.missing
        .map((m) => project.media.find((item) => item.id === m)?.path ?? m)
        .join(", ")}, so nothing said there is captioned.`,
    );
  const plan: CaptionsPlan = {
    revision: file.revision,
    track: name,
    captions: planned.map(({ start, end, text }) => ({ start, end, text })),
    commands,
    label: request.label ?? `Caption ${plural(planned.length, "line")}`,
    warnings,
    missing: map.missing,
  };
  if (!planned.length) return plan;
  const scratch = new ProjectCoordinator({ revision: file.revision, project });
  plan.warnings.push(
    ...scratch.apply({ label: plan.label, commands, expectedRevision: file.revision }).warnings,
  );
  return plan;
}
