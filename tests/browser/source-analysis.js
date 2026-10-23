import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { sourceSamples, readMono } from "../../packages/platform-browser/src/source-analysis.ts";
import { generateProxy, cachedProxy } from "../../packages/platform-browser/src/proxy.ts";
import {
  cachedTranscript,
  transcribeLocal,
} from "../../packages/platform-browser/src/transcription.ts";
import { syncSound } from "../../packages/platform-browser/src/sound-sync.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { probeLocalFile } from "../../packages/platform-browser/src/media.ts";
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const signal = () => new AbortController().signal;
const nothing = () => {};
const itemOf = (item) =>
  decodeProjectFile({ revision: 0, project: { media: [item] } }).project.media[0];

export async function transparentFixture() {
  const { Output, WebMOutputFormat, BufferTarget, CanvasSource } = await import("mediabunny");
  const target = new BufferTarget(),
    output = new Output({ format: new WebMOutputFormat(), target });
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { alpha: true });
  const video = new CanvasSource(canvas, { codec: "vp9", bitrate: 500000, alpha: "keep" });
  output.addVideoTrack(video, { frameRate: 4 });
  await output.start();
  for (let i = 0; i < 8; i++) {
    ctx.clearRect(0, 0, 1280, 720);
    ctx.fillStyle = i < 4 ? "rgba(255,0,0,0.5)" : "rgba(0,255,0,0.5)";
    ctx.fillRect(640, 0, 640, 720);
    await video.add(i / 4, 0.25);
  }
  video.close();
  await output.finalize();
  return new File([target.buffer], "alpha-camera.webm", { type: "video/webm" });
}
export async function verifySources() {
  const file = await transparentFixture(),
    { item: raw } = await probeLocalFile(file),
    item = itemOf(raw);
  const samples = await sourceSamples(file, item, signal(), nothing);
  const proxy = await generateProxy(file, item, signal(), nothing);
  assert(proxy.width === 640 && proxy.frames.length === 8, "Proxy dimensions/frame count");
  assert((await cachedProxy(file)).frames.length === 8, "Proxy persistent cache");
  const reader = await LocalMediaReader.open(file, "video", 640);
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  const pixels = [];
  try {
    for (const time of [0, 0.25, 0.9, 1, 1.9]) {
      const original = await reader.frame(time);
      ctx.clearRect(0, 0, 640, 360);
      ctx.drawImage(original.canvas, 0, 0);
      const expected = ctx.getImageData(480, 180, 1, 1).data;
      const backed = await LocalMediaReader.open(file, "video", 640);
      try {
        backed.useProxy(proxy);
        const frame = await backed.frame(time);
        ctx.clearRect(0, 0, 640, 360);
        ctx.drawImage(frame.canvas, 0, 0);
        const transparent = [...ctx.getImageData(10, 10, 1, 1).data],
          actual = [...ctx.getImageData(480, 180, 1, 1).data];
        assert(
          transparent[3] <= 2 && Math.abs(actual[3] - 128) <= 2,
          `Proxy alpha: transparent ${transparent}, actual ${actual}, expected ${expected}`,
        );
        assert(
          actual.every((v, i) => Math.abs(v - expected[i]) <= 1),
          "Proxy picture agreement",
        );
        assert(frame.timestamp === original.timestamp, "Proxy source timestamp");
        pixels.push({ time, timestamp: frame.timestamp, alpha: actual[3] });
      } finally {
        backed.close();
      }
    }
  } finally {
    reader.close();
  }
  assert(
    (await sourceSamples(file, item, signal(), nothing)).thumbnails.length ===
      samples.thumbnails.length,
    "Analysis cache reuse",
  );
  const project = decodeProjectFile({
    revision: 0,
    project: {
      settings: { width: 320, height: 180, frameRate: { numerator: 4, denominator: 1 } },
      media: [raw],
      videoTracks: [
        {
          id: "bg",
          kind: "video",
          clips: [
            { id: "blue", duration: 2, content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } } },
          ],
        },
        {
          id: "fg",
          kind: "video",
          clips: [{ id: "alpha", duration: 2, content: { media: { mediaID: item.id } } }],
        },
      ],
    },
  }).project;
  const output = await renderWebM(
    project,
    async () => ({ file, state: "available", detail: "fixture" }),
    signal(),
    nothing,
  );
  const exported = await LocalMediaReader.open(new File([output], "export.webm"), "video", 320);
  try {
    const frame = await exported.frame(0.5);
    canvas.width = 320;
    canvas.height = 180;
    ctx.drawImage(frame.canvas, 0, 0);
    const background = [...ctx.getImageData(20, 80, 1, 1).data],
      foreground = [...ctx.getImageData(240, 80, 1, 1).data];
    assert(
      background[2] > 220 && foreground[0] > 100 && foreground[2] > 100,
      "Original export keeps alpha composition",
    );
    return {
      proxy: {
        width: proxy.width,
        height: proxy.height,
        frames: proxy.frames.length,
        format: proxy.format,
      },
      thumbnails: samples.thumbnails.length,
      pixels,
      export: { bytes: output.size, background, foreground },
    };
  } finally {
    exported.close();
  }
}
export async function verifySpeech(transcribe = true) {
  const file = new File(
    [
      await (
        await fetch("/@fs/C:/sharull/coding/personal/side-cut/tests/fixtures/audio/speech.wav")
      ).arrayBuffer(),
    ],
    "speech.wav",
    { type: "audio/wav" },
  );
  const { item: raw } = await probeLocalFile(file),
    item = itemOf(raw);
  const peaks = await sourceSamples(file, item, signal(), nothing);
  assert(
    peaks.peaks.some((v) => v > 0.1),
    "Nonempty waveform",
  );
  const sound = await readMono(file, item, 8000, signal(), nothing),
    delay = 1973;
  const other = new Float32Array(sound.length + delay);
  other.set(sound, delay);
  const match = await syncSound(sound.slice(), other, signal());
  assert(Math.abs(match.offset - delay / 8000) < 1 / 8000, "Speech sync within one 8 kHz sample");
  if (!transcribe) return { peaks: peaks.peaks.length, match };
  const input = await readMono(file, item, 16000, signal(), nothing);
  const start = performance.now();
  const transcript = await transcribeLocal(
    file,
    input,
    signal(),
    (value) => {
      window.speechProgress = value;
    },
    (status) => {
      window.speechStatus = status;
    },
  );
  assert(transcript.words.length >= 8, "Usable speech word count");
  assert(
    transcript.words.every((w) => w.start >= 0 && w.end >= w.start && w.end <= 8.5),
    "Usable source word times",
  );
  assert(
    JSON.stringify(await cachedTranscript(file)) === JSON.stringify(transcript),
    "Transcript cache",
  );
  return { peaks: peaks.peaks.length, match, milliseconds: performance.now() - start, transcript };
}

export async function startSpeech() {
  window.speechResult = null;
  window.speechError = null;
  void verifySpeech()
    .then((result) => {
      window.speechResult = result;
    })
    .catch((error) => {
      window.speechError = String(error);
    });
  return "Speech verification started";
}

export async function verifyPersistentSpeechCache() {
  const file = new File(
    [
      await (
        await fetch("/@fs/C:/sharull/coding/personal/side-cut/tests/fixtures/audio/speech.wav")
      ).arrayBuffer(),
    ],
    "speech.wav",
    { type: "audio/wav" },
  );
  const item = itemOf((await probeLocalFile(file)).item);
  const open = LocalMediaReader.open;
  LocalMediaReader.open = () => {
    throw new Error("Cache reuse decoded the source again");
  };
  try {
    return {
      words: (await cachedTranscript(file)).words.length,
      peaks: (await sourceSamples(file, item, signal(), nothing)).peaks.length,
    };
  } finally {
    LocalMediaReader.open = open;
  }
}

export async function verifyTranscriptionCancellation() {
  const file = new File(["synthetic-cache-identity", String(Date.now())], "cancel.wav"),
    controller = new AbortController();
  let enteredInference = false,
    cancelled = false;
  try {
    await transcribeLocal(file, new Float32Array(16000), controller.signal, nothing, (status) => {
      if (status.startsWith("Transcribing")) {
        enteredInference = true;
        controller.abort();
      }
    });
  } catch {
    cancelled = controller.signal.aborted;
  }
  assert(enteredInference && cancelled, "Local inference worker cancellation");
  assert(!(await cachedTranscript(file)), "Cancelled inference was cached");
  return { enteredInference, cancelled, cached: false };
}
