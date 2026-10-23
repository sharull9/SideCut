// Ported from TandemMedia/WordPlacement.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}
export interface Transcript {
  model: string;
  language: string;
  words: readonly TranscriptWord[];
}
export interface PlacedWord extends TranscriptWord {
  index: number;
  clipID: string;
}

export function validateTranscript(value: Transcript): Transcript {
  if (
    !value ||
    typeof value.model !== "string" ||
    typeof value.language !== "string" ||
    !Array.isArray(value.words)
  )
    throw new Error("Invalid transcript cache.");
  for (const word of value.words)
    if (
      typeof word.text !== "string" ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < 0 ||
      word.end < word.start
    )
      throw new Error("Transcript words need valid source timestamps.");
  return value;
}

// The lane hides disabled clips; search passes them like the reference's `placements(on:)`.
export function placeWords(
  transcript: Transcript,
  clips: readonly Clip[],
  options: { includeDisabled?: boolean } = {},
): PlacedWord[] {
  const playing = clips
    .filter(
      (c) =>
        (c.enabled || options.includeDisabled === true) &&
        !c.freezeFrame &&
        c.speed > 0 &&
        c.duration.flicks > 0n,
    )
    .toSorted((a, b) => a.start.seconds - b.start.seconds);
  const result: PlacedWord[] = [];
  transcript.words.forEach((word, index) => {
    const low = Time.fromSeconds(word.start).flicks;
    const high =
      Time.fromSeconds(word.end).flicks > low ? Time.fromSeconds(word.end).flicks : low + 1n;
    const parts = playing.flatMap((clip, rank) => {
      const sourceLow = clip.sourceStart.flicks;
      const sourceHigh = sourceLow + Time.fromSeconds(clip.duration.seconds * clip.speed).flicks;
      const from = low > sourceLow ? low : sourceLow;
      const to = high < sourceHigh ? high : sourceHigh;
      return to > from ? [{ clip, rank, from, to }] : [];
    });
    let kept = 0n,
      end = low;
    for (const part of parts.toSorted((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
      if (part.to > end) kept += part.to - (part.from > end ? part.from : end);
      if (part.to > end) end = part.to;
    }
    if (kept * 2n < high - low || !parts.length) return;
    const home = parts.reduce((best, part) =>
      part.to - part.from > best.to - best.from ? part : best,
    );
    for (const part of parts) {
      if (part !== home && (part.to - part.from) * 2n <= high - low) continue;
      const start =
        part.clip.start.seconds +
        new Time(part.from - part.clip.sourceStart.flicks).seconds / part.clip.speed;
      const finish = Math.min(
        part.clip.start.seconds + part.clip.duration.seconds,
        part.clip.start.seconds +
          new Time(part.to - part.clip.sourceStart.flicks).seconds / part.clip.speed,
      );
      result.push({ ...word, index, clipID: part.clip.id, start, end: Math.max(start, finish) });
    }
  });
  return result.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
}
