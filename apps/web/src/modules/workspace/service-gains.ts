import type { Project } from "@sidecut/contracts/project";
import type { LocalMediaReader } from "@sidecut/platform-browser/preview";
import type { MeasuredSound } from "@sidecut/core/loudness";
import { mixTimelineAudio } from "@sidecut/platform-browser/audio";
import { audioEnvelope } from "@sidecut/core/audio-processing";
import { audioSegments } from "@sidecut/core/audio-plan";
import { compareGains } from "@sidecut/core/gain-follow";

export async function verifyGainLanes(
  project: Project,
  start: number,
  end: number,
  reader: (id: string) => Promise<LocalMediaReader>,
  measure: (id: string) => Promise<MeasuredSound>,
  signal: AbortSignal,
) {
  const results = [];
  for (const track of project.audioTracks.filter(
    (t) =>
      !t.muted &&
      (!project.audioTracks.some((candidate) => candidate.solo && !candidate.muted) || t.solo),
  )) {
    const solo = {
      ...project,
      audioTracks: project.audioTracks.map((t) => ({
        ...t,
        muted: t.id !== track.id,
        solo: false,
      })),
    };
    const flat = {
      ...solo,
      audioTracks: solo.audioTracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({
          ...c,
          audio: { ...c.audio, gainDB: 0, normalizeTo: null, fadeIn: 0, fadeOut: 0 },
          keyframes: Object.fromEntries(
            Object.entries(c.keyframes).filter(([key]) => key !== "audio.gainDB"),
          ),
        })),
      })),
    };
    const energies = async (p: Project) => {
      const values: number[] = [];
      for await (const b of mixTimelineAudio(p, reader, signal, 48000, 480, end, {
        start,
        master: false,
        measure,
      })) {
        let sum = 0;
        for (const v of b.data) sum += v * v;
        values.push(sum);
      }
      return values;
    };
    const heard = await energies(solo),
      plain = await energies(flat),
      segments = audioSegments(solo);
    const envelopes = await Promise.all(
      segments.map(async (s) => ({
        segment: s,
        envelope: audioEnvelope(s.clip, (await measure(s.mediaID)).integratedLUFS),
      })),
    );
    const expected: (number | null)[] = [],
      measured: (number | null)[] = [];
    for (let i = 0; i < Math.min(heard.length, plain.length); i++) {
      let power = 0,
        overlap = false;
      for (let k = 0; k < 8; k++) {
        const time = start + (i + (k + 0.5) / 8) * 0.01,
          active = envelopes.filter((e) => e.segment.start <= time && e.segment.end > time);
        if (active.length > 1) overlap = true;
        const entry = active[0],
          gain = entry ? entry.envelope(time - entry.segment.clip.start.seconds) : 0;
        power += gain * gain;
      }
      power /= 8;
      const usable = !overlap && power > 1e-6 && plain[i]! > 1e-8 * 960;
      expected.push(usable ? 10 * Math.log10(power) : null);
      measured.push(
        usable ? (heard[i]! > 0 ? 10 * Math.log10(heard[i]! / plain[i]!) : -120) : null,
      );
    }
    results.push({
      trackID: track.id,
      track: track.name,
      ...compareGains(expected, measured, start),
    });
  }
  return results;
}
