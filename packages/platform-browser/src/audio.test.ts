import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { mixTimelineAudio } from "./audio";
const p = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      media: [{ id: "m", path: "tone.wav", kind: "audio", duration: 1 }],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          clips: [
            {
              id: "a",
              start: 0.1,
              duration: 0.2,
              sourceStart: 0.2,
              content: { media: { mediaID: "m" } },
            },
          ],
        },
        {
          id: "b",
          kind: "audio",
          clips: [
            {
              id: "b",
              start: 0.2,
              duration: 0.2,
              sourceStart: 0.4,
              content: { media: { mediaID: "m" } },
            },
          ],
        },
      ],
    },
  }).project;
const reader = () => ({
  audio: async function* (from: number, to: number) {
    const values = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
    yield {
      timestamp: 0,
      duration: 1,
      buffer: {
        sampleRate: 1000,
        length: 1000,
        numberOfChannels: 1,
        getChannelData: () => values,
      } as unknown as AudioBuffer,
    };
    expect(to).toBeGreaterThan(from);
  },
});
describe("block audio mixer", () => {
  it("mixes overlaps at exact samples, duplicates mono, and preserves silence around clips", async () => {
    const samples: number[] = [];
    for await (const block of mixTimelineAudio(
      p(),
      async () => reader(),
      new AbortController().signal,
      1000,
      64,
      0.5,
    )) {
      expect(block.data.slice(0, block.frames)).toEqual(block.data.slice(block.frames));
      samples.push(...block.data.subarray(0, block.frames));
    }
    expect(samples).toHaveLength(500);
    expect(samples[0]).toBe(0);
    expect(samples[99]).toBe(0);
    expect(samples[100]).toBe(0);
    expect(samples[103]).toBeCloseTo(0.203);
    expect(samples[200]).toBeCloseTo(0.3);
    expect(samples[203]).toBeCloseTo(0.706);
    expect(samples[300]).toBeCloseTo(0.5);
    expect(samples[400]).toBe(0);
  });
  it("closes active iterators on cancellation", async () => {
    let closed = false;
    const r = {
      audio: async function* () {
        try {
          yield {
            timestamp: 0,
            duration: 1,
            buffer: {
              sampleRate: 1000,
              length: 1000,
              numberOfChannels: 1,
              getChannelData: () => new Float32Array(1000),
            } as unknown as AudioBuffer,
          };
        } finally {
          closed = true;
        }
      },
    };
    const abort = new AbortController(),
      stream = mixTimelineAudio(p(), async () => r, abort.signal, 1000, 200);
    await stream.next();
    abort.abort();
    await expect(stream.next()).rejects.toThrow();
    expect(closed).toBe(true);
  });
});
