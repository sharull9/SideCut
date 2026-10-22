import { it, expect, vi } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { LoudnessMeter } from "@sidecut/core/loudness";
import { masterAudio, mixTimelineAudio, prepareTimelineAudio } from "./audio";
import { Time } from "@sidecut/contracts/time";
import { audioIdentity, measureSource } from "./audio-analysis";
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
