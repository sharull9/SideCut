import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import {
  audioGain,
  audioEnvelope,
  gain,
  normalizeGain,
  compress,
  limit,
  pitchAndSpeed,
} from "./audio-processing";
import { LoudnessMeter } from "./loudness";
import { ProjectCoordinator, replayJournal } from "./coordinator";
import { seamlessAudio } from "./audio-plan";
const rate = 48000;
const tone = (seconds = 1, amplitude = 0.1, frequency = 1000) =>
  Float32Array.from(
    { length: seconds * rate },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate),
  );
const measure = (channels: Float32Array[]) => {
  const m = new LoudnessMeter(rate, channels.length);
  m.process(channels);
  return m.result();
};
const fixture = (audio: unknown = {}, extra: object = {}) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "sound",
      media: [{ id: "m", path: "tone.wav", kind: "audio", duration: 4 }],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          clips: [{ id: "c", content: { media: { mediaID: "m" } }, duration: 2, audio, ...extra }],
        },
      ],
    },
  });
const clip = (audio: unknown = {}, extra: object = {}) =>
  fixture(audio, extra).project.audioTracks[0]!.clips[0]!;
describe("audio gain and loudness", () => {
  it("replaces base gain with animation, adds bounded source levelling, and fades in equal power", () => {
    const c = clip(
      { gainDB: 24, normalizeTo: -20, fadeIn: 1, fadeOut: 1 },
      {
        keyframes: {
          "audio.gainDB": [
            { time: 0, value: -6, interpolation: "linear" },
            { time: 2, value: 6 },
          ],
        },
      },
    );
    expect(audioGain(c, 1, -30)).toBeCloseTo(gain(10), 6);
    expect(audioGain(c, 0, -30)).toBe(0);
    expect(audioGain(c, 0.5, -30)).toBeCloseTo(gain(7) * Math.SQRT1_2, 6);
    expect(audioEnvelope(c, -30)(0.5)).toBeCloseTo(audioGain(c, 0.5, -30), 6);
    expect(gain(-96)).toBe(0);
    expect(gain(-95.99)).toBeGreaterThan(0);
    expect(normalizeGain(-20, -90)).toBe(30);
    expect(normalizeGain(-40, 0)).toBe(-30);
    expect(normalizeGain(-20, -Infinity)).toBe(0);
  });
  it("recognizes an inaudible through cut and rejects a mismatched gain", () => {
    const a = clip(),
      b = { ...a, start: a.duration, sourceStart: a.duration };
    expect(seamlessAudio(a, b)).toBe(true);
    expect(seamlessAudio(a, { ...b, audio: { gainDB: 1 } })).toBe(false);
  });
  it("calibrates 1 kHz mono and stereo within 0.1 LU, with stable chunk boundaries", () => {
    const signal = tone(4),
      mono = measure([signal]),
      stereo = measure([signal, signal]);
    expect(mono.integratedLUFS).toBeCloseTo(-23.0, 1);
    expect(stereo.integratedLUFS - mono.integratedLUFS).toBeCloseTo(10 * Math.log10(2), 5);
    expect(mono.truePeakDBTP).toBeCloseTo(-20, 1);
    const meter = new LoudnessMeter(rate, 1);
    for (let i = 0; i < signal.length; i += 1237) meter.process([signal.subarray(i, i + 1237)]);
    expect(meter.result()).toEqual(mono);
    expect(mono.loudnessRange).toBeLessThan(0.1);
  });
  it("gates silence, measures range and detects intersample peaks", () => {
    expect(measure([new Float32Array(rate)]).integratedLUFS).toBe(-Infinity);
    const signal = tone(8, 0.1);
    for (let i = rate * 4; i < signal.length; i++) signal[i]! *= 0.1;
    expect(measure([signal]).loudnessRange).toBeGreaterThan(8);
    const hot = Float32Array.from({ length: rate }, (_, i) =>
      Math.sin((2 * Math.PI * 12000 * i) / rate + Math.PI / 4),
    );
    expect(measure([hot]).truePeakDBTP).toBeGreaterThan(-1);
    expect(() => measure([new Float32Array([NaN])])).toThrow(/non-finite/);
  });
});
describe("pitch and dynamics", () => {
  it("compresses a sustained amplitude step using one stereo gain", async () => {
    const loud = new Float32Array(rate).fill(0.5),
      right = new Float32Array(rate).fill(0.25);
    await compress([loud, right], rate, {
      threshold: -20,
      ratio: 4,
      attack: 10,
      release: 100,
      knee: 0,
    });
    expect(loud[rate - 1]).toBeCloseTo(0.1 * 5 ** 0.25, 3);
    expect(right[rate - 1]! / loud[rate - 1]!).toBeCloseTo(0.5, 6);
    const unity = tone();
    const original = unity.slice();
    await compress([unity], rate, { ratio: 1, makeup: 0 });
    expect(unity).toEqual(original);
  });
  it("limits true peaks, compensates lookahead, and preserves the tail", async () => {
    const signal = tone(1, 2, 12000),
      right = Float32Array.from(signal, (v) => v * 0.5);
    await limit([signal, right], rate, -3);
    expect(measure([signal, right]).truePeakDBTP).toBeLessThanOrEqual(-2.95);
    expect(Math.abs(signal[rate - 3]!)).toBeGreaterThan(0.1);
    expect(right[1000]! / signal[1000]!).toBeCloseTo(0.5);
    const impulse = new Float32Array(rate);
    impulse[1000] = 0.1;
    await limit([impulse], rate, -1);
    expect(impulse[1000]).toBeCloseTo(0.1);
    expect(impulse[999]).toBe(0);
  });
  it("shifts an octave and preserves tone frequency through a speed change", async () => {
    const countCrossings = (signal: Float32Array) => {
      let count = 0;
      for (let i = rate / 4; i < (rate * 3) / 4; i++)
        if (signal[i]! <= 0 && signal[i + 1]! > 0) count++;
      return count * 2;
    };
    const pitched = await pitchAndSpeed(
      [tone(2, 0.2, 400)],
      rate,
      clip({
        effects: [{ id: "fx", type: "pitchShift", enabled: true, params: { semitones: 12 } }],
      }),
    );
    expect(pitched[0]!.length).toBe(rate * 2);
    expect(countCrossings(pitched[0]!)).toBeCloseTo(800, -1);
    const faster = await pitchAndSpeed([tone(4, 0.2, 400)], rate, clip({}, { speed: 2 }));
    expect(faster[0]!.length).toBe(rate * 2);
    expect(countCrossings(faster[0]!)).toBeCloseTo(400, -1);
  });
  it("cancels actual dynamics work", async () => {
    const cancel = async () => {
      throw new Error("Cancelled");
    };
    await expect(limit([tone()], rate, -1, 100, cancel)).rejects.toThrow(/Cancelled/);
    await expect(compress([tone()], rate, {}, cancel)).rejects.toThrow(/Cancelled/);
  });
});
describe("speech normalization command", () => {
  it("adds measured protection once and preserves animation, undo, and journal replay", () => {
    const file = fixture(
      { gainDB: 5 },
      { keyframes: { "audio.gainDB": [{ time: 0, value: -3 }] } },
    );
    const c = new ProjectCoordinator(file),
      command = { normalizeSpeech: { measured: { m: { integratedLUFS: -40, truePeakDBTP: -5 } } } };
    const result = c.apply({ commands: [command] });
    const edited = c.getSnapshot().project.audioTracks[0]!.clips[0]!;
    expect(edited.audio).toMatchObject({
      gainDB: 0,
      normalizeTo: -20,
      effects: [
        { type: "compressor", params: { threshold: -14, ratio: 3 } },
        { type: "limiter", params: { ceiling: -1 } },
      ],
    });
    expect(edited.keyframes).toEqual(file.project.audioTracks[0]!.clips[0]!.keyframes);
    expect(result.createdIDs).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/gain animation/);
    const before = c.getSnapshot().project;
    c.undo();
    expect(c.getSnapshot().project).toEqual(file.project);
    c.redo();
    expect(c.getSnapshot().project).toEqual(before);
    c.apply({ commands: [command] });
    expect(c.getSnapshot().project.audioTracks[0]!.clips[0]!.audio?.effects).toHaveLength(2);
    expect(replayJournal(c.projectFile()).project).toEqual(c.getSnapshot().project);
  });
  it("honors disabled limiters and locked tracks, and excludes music on follow tracks", () => {
    const f = fixture({ effects: [{ id: "off", type: "limiter", enabled: false, params: {} }] });
    const c = new ProjectCoordinator(f);
    c.apply({
      commands: [
        { normalizeSpeech: { measured: { m: { integratedLUFS: -40, truePeakDBTP: -5 } } } },
      ],
    });
    expect(c.getSnapshot().project.audioTracks[0]!.clips[0]!.audio?.effects).toEqual([
      { id: "off", type: "limiter", enabled: false, params: {} },
    ]);
    const locked = new ProjectCoordinator({
      ...f,
      project: {
        ...f.project,
        audioTracks: f.project.audioTracks.map((t) => ({ ...t, locked: true })),
      },
    });
    expect(locked.apply({ commands: [{ normalizeSpeech: {} }] }).warnings.join(" ")).toMatch(
      /Locked track/,
    );
    expect(locked.getSnapshot().project.audioTracks[0]!.clips).toEqual(
      f.project.audioTracks[0]!.clips,
    );
    const music = new ProjectCoordinator({
      ...f,
      project: {
        ...f.project,
        media: f.project.media.map((m) => ({ ...m, role: "music" as const })),
        audioTracks: f.project.audioTracks.map((t) => ({ ...t, rippleMode: "follow" as const })),
      },
    });
    expect(music.apply({ commands: [{ normalizeSpeech: {} }] }).warnings.join(" ")).toMatch(
      /no speech clips/,
    );
  });
  it("rejects stale revisions and malformed measurements atomically", () => {
    const c = new ProjectCoordinator(fixture());
    const before = c.getSnapshot();
    expect(() => c.apply({ expectedRevision: 1, commands: [{ normalizeSpeech: {} }] })).toThrow(
      /revision/,
    );
    expect(() =>
      c.apply({
        commands: [
          { normalizeSpeech: { measured: { m: { integratedLUFS: NaN, truePeakDBTP: 0 } } } },
        ],
      }),
    ).toThrow();
    expect(c.getSnapshot()).toBe(before);
  });
});
