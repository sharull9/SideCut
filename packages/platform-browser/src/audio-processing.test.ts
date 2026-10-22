import { it, expect, vi } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { LoudnessMeter } from "@sidecut/core/loudness";
import { masterAudio, mixTimelineAudio, prepareTimelineAudio } from "./audio";
import { Time } from "@sidecut/contracts/time";
import { cleanVoice } from "@sidecut/core/audio-processing";
import { audioIdentity, measureSource } from "./audio-analysis";
import * as voice from "./voice-isolation";
const rate = 48000;
const buffer = (values: Float32Array) =>
  ({
    sampleRate: rate,
    length: values.length,
    numberOfChannels: 1,
    getChannelData: () => values,
  }) as unknown as AudioBuffer;
const reader = (values: Float32Array) => ({
  audio: async function* () {
    yield { buffer: buffer(values), timestamp: 0, duration: values.length / rate };
  },
});
const p = (audio: object) =>
  decodeProjectFile({
    revision: 0,
    project: {
      media: [{ id: "m", path: "test.wav", kind: "audio", duration: 1 }],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          clips: [
            {
              id: "c",
              content: { media: { mediaID: "m" } },
              sourceStart: 0.2,
              duration: 0.5,
              audio,
            },
          ],
        },
      ],
    },
  }).project;
it("retains samples when decoded packet timestamps round above the sample clock", async () => {
  const source = {
    audio: async function* () {
      for (let first = 0; first < rate; first += 2048) {
        const length = Math.min(2048, rate - first);
        yield {
          buffer: buffer(new Float32Array(length).fill(0.25)),
          timestamp: first / rate + 1e-15,
          duration: length / rate,
        };
      }
    },
  };
  const values: number[] = [];
  for await (const block of mixTimelineAudio(
    p({}),
    async () => source,
    new AbortController().signal,
  ))
    values.push(...block.data.subarray(0, block.frames));
  expect(Math.min(...values.slice(144, -144))).toBeCloseTo(0.25, 6);
});
it("processes dry and isolated dynamics independently before blending normalized audio", async () => {
  const isolation = vi
    .spyOn(voice, "isolateVoice")
    .mockImplementation(async (channels) =>
      channels.map((c) => Float32Array.from(c, (sample) => sample * 0.1)),
    );
  const collect = async (mix: number) => {
    const values: number[] = [];
    for await (const block of mixTimelineAudio(
      p({
        voiceIsolation: mix,
        gainDB: 3,
        normalizeTo: -20,
        effects: [
          {
            id: "cleanup",
            type: "voiceCleanup",
            enabled: true,
            params: { highPass: 0, expanderThreshold: -40, expanderRange: 20 },
          },
        ],
      }),
      async () => reader(new Float32Array(rate).fill(0.002)),
      new AbortController().signal,
      rate,
      4096,
      0.5,
      { measure: async () => ({ integratedLUFS: -24, truePeakDBTP: -30, loudnessRange: 0 }) },
    ))
      values.push(...block.data.subarray(0, block.frames));
    return values;
  };
  try {
    const dry = await collect(0),
      half = await collect(0.5),
      wet = await collect(1);
    expect(half[12000]).toBeCloseTo((dry[12000]! + wet[12000]!) / 2, 8);
  } finally {
    isolation.mockRestore();
  }
});
it("processes source offsets with gain, equal-power fades and cached normalization", async () => {
  const project = p({ gainDB: -6, normalizeTo: -20, fadeIn: 0.2, fadeOut: 0.2 });
  const measure = vi.fn(async () => ({ integratedLUFS: -30, truePeakDBTP: -20, loudnessRange: 0 }));
  const result: number[] = [];
  for await (const block of mixTimelineAudio(
    project,
    async () => reader(new Float32Array(rate).fill(0.1)),
    new AbortController().signal,
    rate,
    4096,
    0.5,
    { measure },
  ))
    result.push(...block.data.subarray(0, block.frames));
  expect(measure).toHaveBeenCalledTimes(1);
  expect(result[0]).toBe(0);
  expect(result[4800]).toBeCloseTo(0.1 * 10 ** (4 / 20) * Math.SQRT1_2, 5);
  expect(result[12000]).toBeCloseTo(0.1 * 10 ** (4 / 20), 5);
  expect(result.at(-1)).toBeLessThan(0.0001);
});
it("masters stereo to the project target and catches true peaks without shifting samples", async () => {
  const signal = Float32Array.from(
    { length: rate },
    (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate),
  );
  const output = await masterAudio([signal, signal], rate, -14, -1);
  const meter = new LoudnessMeter(rate, 2);
  meter.process(output);
  expect(meter.result().integratedLUFS).toBeCloseTo(-14, 1);
  expect(meter.result().truePeakDBTP).toBeLessThan(-1);
  expect(output[0]!.length).toBe(rate);
  const peaks = Float32Array.from(signal, (sample, i) => (i % 4800 < 40 ? sample * 50 : sample));
  const limited = await masterAudio([peaks, peaks], rate, -14, -1);
  const peakMeter = new LoudnessMeter(rate, 2);
  peakMeter.process(limited);
  expect(peakMeter.result().truePeakDBTP).toBeLessThanOrEqual(-0.95);
});
it("keys analysis by bytes and version and reuses a completed measurement", async () => {
  const first = new File(["analysis-a"], "same.wav", { lastModified: 1 }),
    second = new File(["analysis-b"], "same.wav", { lastModified: 1 });
  expect(await audioIdentity(first)).not.toBe(await audioIdentity(second));
  const source = reader(new Float32Array(rate));
  const read = vi.spyOn(source, "audio");
  const signal = new AbortController().signal;
  expect((await measureSource(first, source, signal)).integratedLUFS).toBe(-Infinity);
  await measureSource(first, source, signal);
  expect(read).toHaveBeenCalledTimes(1);
});
it("does not cache cancelled analysis or leave its decoder iterator open", async () => {
  const controller = new AbortController();
  let closed = false;
  const source = {
    audio: async function* () {
      try {
        controller.abort();
        yield { buffer: buffer(new Float32Array(rate)), timestamp: 0, duration: 1 };
      } finally {
        closed = true;
      }
    },
  };
  await expect(
    measureSource(new File(["cancel-analysis"], "cancel.wav"), source, controller.signal),
  ).rejects.toThrow();
  expect(closed).toBe(true);
});
it("prepares later processed clips before playback and reuses their PCM without decoding again", async () => {
  const base = p({ gainDB: -3 }),
    track = base.audioTracks[0]!,
    clip = track.clips[0]!;
  const project = {
    ...base,
    audioTracks: [
      { ...track, clips: [clip, { ...clip, id: "later", start: Time.fromSeconds(0.6) }] },
    ],
  };
  const read = vi.fn(async () => reader(new Float32Array(rate).fill(0.1))),
    signal = new AbortController().signal;
  const prepared = await prepareTimelineAudio(project, read, signal);
  expect(prepared.size).toBe(2);
  expect(read).toHaveBeenCalledTimes(2);
  const stream = mixTimelineAudio(project, read, signal, rate, 4096, 1.1, { prepared });
  for await (const block of stream) expect(block.frames).toBeGreaterThan(0);
  expect(read).toHaveBeenCalledTimes(2);
  const abort = new AbortController();
  abort.abort();
  await expect(prepareTimelineAudio(project, read, abort.signal)).rejects.toThrow();
});
it("crossfades centered source handles in equal power and leaves unavailable handles silent", async () => {
  const project = decodeProjectFile({
    revision: 0,
    project: {
      media: [{ id: "m", path: "tone.wav", kind: "audio", duration: 2 }],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          clips: [
            { id: "left", duration: 0.5, sourceStart: 0.25, content: { media: { mediaID: "m" } } },
            {
              id: "right",
              start: 0.5,
              duration: 0.5,
              sourceStart: 0.75,
              content: { media: { mediaID: "m" } },
            },
          ],
          transitions: [
            { id: "tr", type: "dissolve", duration: 0.3, fromClipID: "left", toClipID: "right" },
          ],
        },
      ],
    },
  }).project;
  const samples: number[] = [];
  for await (const block of mixTimelineAudio(
    project,
    async () => reader(new Float32Array(rate * 2).fill(0.25)),
    new AbortController().signal,
  ))
    samples.push(...block.data.subarray(0, block.frames));
  expect(samples[rate / 2]).toBeCloseTo(0.25 * Math.SQRT2, 6);
  expect(samples[Math.round(rate * 0.35)]).toBeCloseTo(0.25, 6);
  expect(samples[Math.round(rate * 0.65)]).toBeCloseTo(0.25, 6);
  let jump = 0;
  for (let i = Math.round(rate * 0.34); i < rate * 0.66; i++)
    jump = Math.max(jump, Math.abs(samples[i + 1]! - samples[i]!));
  expect(jump).toBeLessThan(0.0001);
  const bounded = {
    ...project,
    media: project.media.map((m) => ({ ...m, duration: Time.fromSeconds(0.5) })),
    audioTracks: project.audioTracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({ ...c, sourceStart: Time.fromSeconds(0) })),
    })),
  };
  const values: number[] = [];
  for await (const block of mixTimelineAudio(
    bounded,
    async () => reader(new Float32Array(rate / 2).fill(0.25)),
    new AbortController().signal,
  ))
    values.push(...block.data.subarray(0, block.frames));
  expect(values[Math.round(rate * 0.49)]).toBeCloseTo(
    0.25 * Math.sin(((Math.PI / 2) * (0.65 - 0.49)) / 0.3),
    5,
  );
});
it("removes rumble and expands room noise while retaining an active speech-band tone", async () => {
  const rms = (data: Float32Array, from = rate / 2) =>
    Math.sqrt(data.subarray(from).reduce((sum, x) => sum + x * x, 0) / (data.length - from));
  const rumble = Float32Array.from(
      { length: rate },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 30 * i) / rate),
    ),
    tone = Float32Array.from(
      { length: rate },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate),
    );
  const before = rms(rumble);
  await cleanVoice([rumble], rate, { highPass: 80, expanderRange: 0 });
  expect(20 * Math.log10(rms(rumble) / before)).toBeLessThan(-15);
  const original = rms(tone);
  await cleanVoice([tone], rate, { highPass: 80 });
  expect(rms(tone) / original).toBeGreaterThan(0.98);
  const quiet = new Float32Array(rate).fill(0.001);
  await cleanVoice([quiet], rate, { highPass: 0, expanderThreshold: -40, expanderRange: 10 });
  expect(rms(quiet) / 0.001).toBeCloseTo(10 ** (-10 / 20), 2);
});
