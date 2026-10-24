// Ported from TandemAPI/TranscriptTools.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { speechMap, speechTracks, mediaIDOf, type Transcripts } from "./speech";
import type { CardPlacement } from "./section-cards";
export function sectionCuts(
  project: Project,
  placements: CardPlacement[],
  transcripts: Transcripts,
) {
  const map = speechMap(project, transcripts),
    cuts: Record<string, Time> = {},
    warnings: string[] = [];
  const frame = project.settings.frameRate.denominator / project.settings.frameRate.numerator;
  for (const p of placements.filter((candidate) => !candidate.existingClipID)) {
    const marker = p.marker.time,
      reach = p.cutReach.seconds;
    if (map.unknown.some((r) => r.start < marker + reach && r.end > marker - reach)) {
      warnings.push(`No transcript near "${p.marker.name}"; the take is cut at its marker.`);
      continue;
    }
    const index = map.words.findIndex((w) => w.end > marker),
      on = index >= 0 && map.words[index]!.start <= marker ? map.words[index] : undefined;
    const afterSide = on && marker - on.start > on.end - marker;
    const before = afterSide
      ? on
      : map.words
          .slice(0, index < 0 ? map.words.length : index)
          .toSorted((a, b) => b.end - a.end)[0];
    const after = afterSide ? map.words[index + 1] : index >= 0 ? map.words[index] : undefined;
    const high = after?.start,
      low = before ? Math.min(before.end, high ?? before.end) : undefined;
    const half = low != null && high != null ? (high - low) / 2 : Infinity,
      lead = Math.min(0.2, half);
    let ideal = marker;
    if (high != null) ideal = Math.min(ideal, high - lead);
    if (low != null) ideal = Math.max(ideal, low + lead);
    ideal = Math.max(0, ideal);
    const inPause = (t: number) =>
      t >= 0 && (low == null || t >= low - 1e-9) && (high == null || t <= high + 1e-9);
    const fits = (t: number) => inPause(t) && Math.abs(t - marker) <= reach + 1e-9;
    const target = Math.max(marker - reach, Math.min(marker + reach, ideal));
    if (!inPause(target)) {
      if (on)
        warnings.push(
          `The marker "${p.marker.name}" is in "${on.text}" with no nearby pause; the word may be clipped.`,
        );
      continue;
    }
    const down = Time.frames(
      Time.fromSeconds(target).frameIndex(project.settings.frameRate),
      project.settings.frameRate,
    ).seconds;
    let cut =
      [down, down + frame].sort((a, b) => Math.abs(a - target) - Math.abs(b - target)).find(fits) ??
      target;
    const take = [...project.videoTracks, ...project.audioTracks].filter(
      (t) => t.rippleMode === "cut" && !t.locked,
    );
    const sliver = (t: number) =>
      take.some((track) =>
        track.clips.some(
          (c) =>
            c.start.seconds < t &&
            t < c.start.seconds + c.duration.seconds &&
            Math.min(t - c.start.seconds, c.start.seconds + c.duration.seconds - t) < 0.25,
        ),
      );
    if (sliver(cut)) {
      const margin = Math.min(0.05, half);
      const breaks = (t: number) =>
        !speechTracks(project).some((track) =>
          track.clips.some(
            (c) =>
              c.enabled &&
              !c.audio?.muted &&
              !c.freezeFrame &&
              mediaIDOf(c) &&
              c.start.seconds < t &&
              c.start.seconds + c.duration.seconds > t,
          ),
        );
      const edges = [
        ...new Set(
          take.flatMap((t) =>
            t.clips.flatMap((c) => [c.start.seconds, c.start.seconds + c.duration.seconds]),
          ),
        ),
      ];
      cut =
        edges
          .filter(
            (t) =>
              fits(t) &&
              !sliver(t) &&
              (Math.abs(t - cut) < frame ||
                ((low == null || t - low >= margin) && (high == null || high - t >= margin)) ||
                breaks(t)),
          )
          .sort((a, b) => Math.abs(a - cut) - Math.abs(b - cut))[0] ?? cut;
    }
    if (Math.abs(cut - marker) > 1e-9) cuts[p.marker.id] = Time.fromSeconds(cut);
    if (Math.abs(cut - marker) >= frame - 1e-9 && (after || before))
      warnings.push(
        `The marker "${p.marker.name}" is near speech; the take is cut at ${cut.toFixed(3)}s in the pause beside the word.`,
      );
  }
  return { cuts, warnings };
}
