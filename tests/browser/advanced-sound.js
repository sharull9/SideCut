import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { cleanVoice } from "../../packages/core/src/audio-processing.ts";
import { isolateVoice } from "../../packages/platform-browser/src/voice-isolation.ts";
import { mixTimelineAudio } from "../../packages/platform-browser/src/audio.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { BrowserJobs } from "../../packages/platform-browser/src/jobs.ts";
import { Time } from "../../packages/contracts/src/time.ts";
const rate = 48000;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const rms = (values, from, to) =>
  Math.sqrt(
    values.subarray(from * rate, to * rate).reduce((sum, x) => sum + x * x, 0) /
      ((to - from) * rate),
  );
const correlation = (a, b, from = 1.5, to = 8.5) => {
  let xy = 0,
    xx = 0,
    yy = 0;
  for (let i = Math.floor(from * rate); i < to * rate; i++) {
    xy += a[i] * b[i];
    xx += a[i] * a[i];
    yy += b[i] * b[i];
  }
  return xy / Math.sqrt(xx * yy);
};
function wav(values) {
  const buffer = new ArrayBuffer(44 + values.length * 2),
    view = new DataView(buffer);
  const ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, values.length * 2, true);
  for (let i = 0; i < values.length; i++)
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, values[i])) * 32767), true);
  return new File([buffer], "speech-noise.wav", { type: "audio/wav" });
}
export async function speechFixture() {
  const ctx = new AudioContext({ sampleRate: rate });
  let clean;
  try {
    clean = (
      await ctx.decodeAudioData(
        await (await fetch(new URL("../fixtures/audio/speech.wav", import.meta.url))).arrayBuffer(),
      )
    )
      .getChannelData(0)
      .slice();
  } finally {
    await ctx.close();
  }
  const speech = new Float32Array(rate * 10),
    noisy = new Float32Array(rate * 10);
  speech.set(clean, rate);
  let seed = 1;
  for (let i = 0; i < noisy.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noisy[i] =
      speech[i] + 0.006 * Math.sin((2 * Math.PI * 40 * i) / rate) + 0.001 * (seed / 2 ** 32 - 0.5);
  }
  return { speech, noisy, file: wav(noisy) };
}
const fixture = (isolation, effects = []) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "advanced_sound_079_084",
      name: "Voice and crossfade verification",
      settings: { width: 64, height: 64, frameRate: { numerator: 10, denominator: 1 } },
      media: [
        {
          id: "speech",
          path: "speech-noise.wav",
          kind: "audio",
          role: "camera",
          duration: 10,
          attribution: "Open Speech Repository; deterministic synthetic noise added by SideCut",
        },
      ],
      audioTracks: [
        {
          id: "voice",
          name: "Voice",
          kind: "audio",
          clips: [
            {
              id: "voice-clip",
              name: "Speech and room noise",
              duration: 10,
              content: { media: { mediaID: "speech" } },
              audio: { voiceIsolation: isolation, effects },
            },
          ],
        },
      ],
    },
  });
export async function verifyVoice({
  exportEndpoints = true,
  saveFixture = false,
  onStage = () => {},
} = {}) {
  onStage("speech fixture");
  const { noisy, speech, file } = await speechFixture(),
    signal = new AbortController().signal;
  const cleaned = noisy.slice(),
    start = performance.now();
  await cleanVoice([cleaned], rate, {});
  const cleanupMS = performance.now() - start;
  const isolationStart = performance.now(),
    wet = (await isolateVoice([noisy], signal))[0],
    isolationMS = performance.now() - isolationStart;
  const cleanup = {
    noiseReductionDB: 20 * Math.log10(rms(noisy, 9, 9.8) / rms(cleaned, 9, 9.8)),
    speechCorrelation: correlation(speech, cleaned),
    ms: cleanupMS,
  };
  const isolation = {
    noiseReductionDB: 20 * Math.log10(rms(noisy, 9, 9.8) / rms(wet, 9, 9.8)),
    speechCorrelation: correlation(speech, wet),
    ms: isolationMS,
    frames: wet.length,
  };
  assert(
    cleanup.noiseReductionDB > 10 && cleanup.speechCorrelation > 0.8,
    `Cleanup quality: ${JSON.stringify(cleanup)}`,
  );
  assert(
    isolation.noiseReductionDB > 10 &&
      isolation.speechCorrelation > 0.65 &&
      wet.length === noisy.length,
    `Isolation quality: ${JSON.stringify(isolation)}`,
  );
  const resource = { file, state: "available", detail: "Licensed speech and synthetic noise" };
  const collect = async (project, master = false) => {
    const reader = await LocalMediaReader.open(file, "audio"),
      data = new Float32Array(rate * 10);
    let offset = 0;
    try {
      for await (const block of mixTimelineAudio(
        project,
        async () => reader,
        signal,
        rate,
        4096,
        10,
        { master },
      )) {
        data.set(block.data.subarray(0, block.frames), offset);
        offset += block.frames;
      }
    } finally {
      reader.close();
    }
    return data;
  };
  const dry = await collect(fixture(0).project),
    half = await collect(fixture(0.5).project),
    full = await collect(fixture(1).project);
  onStage("blend checked");
  let blendError = 0;
  for (let i = 0; i < half.length; i++)
    blendError = Math.max(blendError, Math.abs(half[i] - (dry[i] + full[i]) / 2));
  assert(blendError < 0.000001, `Dry/wet blend is misaligned: ${blendError}`);
  const encoded = [];
  if (exportEndpoints)
    for (const mix of [0, 0.5, 1]) {
      onStage(`export ${mix}`);
      const project = fixture(mix).project,
        expected = await collect(project, true);
      const blob = await renderWebM(
          project,
          async () => resource,
          signal,
          () => {},
        ),
        context = new AudioContext({ sampleRate: rate });
      try {
        const decoded = await context.decodeAudioData(await blob.arrayBuffer()),
          values = decoded.getChannelData(0);
        // Native Opus decoding may retain a few milliseconds of codec priming.
        let best = -1,
          bestOffset = 0;
        for (let offset = -480; offset <= 480; offset += 8) {
          let xy = 0,
            xx = 0,
            yy = 0;
          for (let i = rate * 2; i < rate * 6; i += 8) {
            const x = values[i + offset] ?? 0,
              y = expected[i];
            xy += x * y;
            xx += x * x;
            yy += y * y;
          }
          const value = xy / Math.sqrt(xx * yy);
          if (value > best) {
            best = value;
            bestOffset = offset;
          }
        }
        assert(best > 0.9, `Export/preview shape mismatch ${mix}: ${best}`);
        encoded.push({ mix, bytes: blob.size, correlation: best, codecOffsetSamples: bestOffset });
      } finally {
        await context.close();
      }
    }
  const cancelled = new AbortController(),
    operation = isolateVoice([new Float32Array(rate * 60)], cancelled.signal);
  cancelled.abort();
  let rejected = false;
  try {
    await operation;
  } catch {
    rejected = true;
  }
  assert(rejected, "Worker cancellation did not reject");
  const restarted = await isolateVoice([new Float32Array(4800)], signal);
  assert(restarted[0].length === 4800, "Worker restart returned stale work");
  if (saveFixture) {
    const store = await BrowserProjectStore.open();
    try {
      assert(
        !(await store.load("advanced_sound_079_084")),
        "Refusing to replace an existing verification project",
      );
      await store.importProject(
        fixture(0.5, [{ id: "cleanup", type: "voiceCleanup", enabled: true, params: {} }]),
      );
      await store.putResource("advanced_sound_079_084", "speech", resource);
    } finally {
      store.close();
    }
  }
  return { cleanup, isolation, blendError, encoded, workerCancellation: rejected };
}
export async function verifyExportJobs() {
  const { file } = await speechFixture(),
    jobs = new BrowserJobs(1),
    signal = new AbortController().signal,
    project = fixture(0.5).project,
    resource = async () => ({ file, state: "available", detail: "Speech fixture" });
  let stale = false;
  const old = jobs.run("export", "Export sound", 10, signal, async (owned, progress) => {
    const blob = await renderWebM(project, resource, owned, (value) => {
      progress(value);
      if (value > 0) jobs.cancel("export");
    });
    stale = true;
    return blob;
  });
  let cancelled = false;
  try {
    await old;
  } catch {
    cancelled = true;
  }
  assert(cancelled && !stale, "Cancelled encoder published a stale result");
  assert(jobs.getSnapshot()[0].status === "cancelled", "Export job was not cancelled");
  const short = {
    ...project,
    audioTracks: project.audioTracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({ ...c, duration: Time.fromSeconds(1) })),
    })),
  };
  const fresh = await jobs.run("export", "Export sound", 10, signal, (owned, progress) =>
    renderWebM(short, resource, owned, progress),
  );
  assert(fresh.size > 0, "Export did not restart");
  return {
    cancelled,
    stale,
    restartedBytes: fresh.size,
    statuses: jobs.getSnapshot().map((j) => j.status),
  };
}
