import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = await createServer({
  configFile: false,
  root,
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { noDiscovery: true },
});
let browser;
let timeout;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  timeout = setTimeout(() => {
    void browser.close();
  }, 45000);
  page.on("console", (message) => console.log(message.text()));
  page.on("pageerror", (error) => console.log(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/tests/browser/`);
  const result = await page.evaluate(async () => {
    const {
      LiveStudio,
      LiveStudioOutput,
      decodeProjectFile,
      LIVE_BACKGROUNDS,
      DEFAULT_LIVE_ASSETS,
      withLiveAssets,
      paintLiveBackground,
      paintLiveOverlays,
      DEFAULT_LIVE_AUDIO,
      LiveAudioChannel,
      LiveAudioMixer,
    } = await import("/tests/browser/live-studio-entry.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    const hash = () => {
      let value = 2166136261;
      for (const byte of ctx.getImageData(0, 0, 320, 180).data)
        value = Math.imul(value ^ byte, 16777619);
      return value >>> 0;
    };
    const patterns = [];
    console.log("Checking procedural backgrounds");
    for (const background of LIVE_BACKGROUNDS) {
      const assets = { ...DEFAULT_LIVE_ASSETS, background };
      paintLiveBackground(ctx, assets, 0);
      const first = hash();
      paintLiveBackground(ctx, assets, 1.25);
      const second = hash();
      paintLiveBackground(ctx, assets, 0, true);
      const reducedFirst = hash();
      paintLiveBackground(ctx, assets, 1.25, true);
      const reducedSecond = hash();
      patterns.push({ background, first, second, reducedFirst, reducedSecond });
    }
    const item = {
      id: "one",
      kind: "takeover",
      text: "",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: "#ff0000",
      textColor: "#ffffff",
      opacity: 1,
      enabled: true,
      motion: "none",
      start: 0,
      duration: 100,
    };
    const pixel = () => [...ctx.getImageData(160, 90, 1, 1).data];
    paintLiveOverlays(
      ctx,
      { ...DEFAULT_LIVE_ASSETS, overlays: [item, { ...item, id: "two", color: "#00ff00" }] },
      1,
    );
    const topPixel = pixel();
    paintLiveOverlays(
      ctx,
      { ...DEFAULT_LIVE_ASSETS, overlays: [{ ...item, id: "two", color: "#00ff00" }, item] },
      1,
    );
    const reorderedPixel = pixel();

    const offline = async (settings, kind = "constant", splitMonitor = false) => {
      const context = new OfflineAudioContext(2, 24000, 48000);
      const buffer = context.createBuffer(1, 24000, 48000);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] =
          kind === "impulse"
            ? i === 0
              ? 0.5
              : 0
            : kind === "rumble"
              ? Math.sin((i / 48000) * Math.PI * 2 * 20) * 0.5
              : 0.5;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const program = context.createGain(),
        monitor = context.createGain();
      if (splitMonitor) {
        const merger = context.createChannelMerger(2);
        program.channelCount = 1;
        monitor.channelCount = 1;
        program.connect(merger, 0, 0);
        monitor.connect(merger, 0, 1);
        merger.connect(context.destination);
      } else {
        program.connect(context.destination);
        monitor.connect(context.destination);
      }
      const channel = new LiveAudioChannel(context, source, program, monitor, {
        ...DEFAULT_LIVE_AUDIO,
        ...settings,
      });
      source.start();
      const rendered = await context.startRendering();
      const left = rendered.getChannelData(0),
        right = rendered.getChannelData(1);
      const rms = (data) =>
        Math.sqrt(data.slice(4800).reduce((s, v) => s + v * v, 0) / (data.length - 4800));
      const onset = left.findIndex((v) => Math.abs(v) > 0.05);
      const measurement = { leftRMS: rms(left), rightRMS: rms(right), onset };
      channel.close();
      return measurement;
    };
    const unity = await offline({});
    console.log("Checking offline audio channels");
    const quiet = await offline({ gainDB: -6.020599913279624 });
    const muted = await offline({ muted: true });
    const delayed = await offline({ syncOffsetMs: 100 }, "impulse");
    const rumble = await offline({ cleanup: "rumble" }, "rumble");
    const unfiltered = await offline({}, "rumble");
    const monitorOff = await offline({}, "constant", true);
    const monitorOn = await offline({ monitor: true }, "constant", true);

    const context = new AudioContext({ sampleRate: 48000 });
    console.log("Checking real-time mixer");
    await context.resume();
    const mixer = new LiveAudioMixer(context);
    const clockSource = context.createConstantSource();
    mixer.addNode("clock", clockSource, { ...DEFAULT_LIVE_AUDIO, muted: true });
    clockSource.start();
    const tone = context.createBuffer(1, 48000 / 5, 48000);
    const samples = tone.getChannelData(0);
    for (let i = 0; i < samples.length; i++)
      samples[i] = Math.sin((i / 48000) * Math.PI * 2 * 880) * 0.5;
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    const deviceDestination = context.createMediaStreamDestination();
    oscillator.connect(deviceDestination);
    oscillator.start();
    const meterChannel = mixer.addStream("input", deviceDestination.stream, {
      ...DEFAULT_LIVE_AUDIO,
      gainDB: -12,
    });
    await new Promise((r) => setTimeout(r, 120));
    const meter = meterChannel.meter();
    meterChannel.update({ ...DEFAULT_LIVE_AUDIO, gainDB: -18 });
    await new Promise((r) => setTimeout(r, 120));
    const updatedMeter = meterChannel.meter();
    meterChannel.update({ ...DEFAULT_LIVE_AUDIO, muted: true });
    await new Promise((r) => setTimeout(r, 120));
    const mutedMeter = meterChannel.meter();
    let invalidUpdateRejected = false;
    try {
      meterChannel.update({ ...DEFAULT_LIVE_AUDIO, syncOffsetMs: -100 });
    } catch {
      invalidUpdateRejected = true;
    }
    const priorSettingsRetained = meterChannel.state.muted;
    mixer.remove("input");
    const borrowedTrackRetained =
      deviceDestination.stream.getAudioTracks()[0].readyState === "live";
    oscillator.stop();
    deviceDestination.stream.getTracks().forEach((t) => t.stop());
    const stereoBuffer = context.createBuffer(2, 48000, 48000);
    for (let i = 0; i < 48000; i++) {
      const value = Math.sin((i / 48000) * Math.PI * 2 * 440) * 0.5;
      stereoBuffer.getChannelData(0)[i] = value;
      stereoBuffer.getChannelData(1)[i] = -value;
    }
    const stereoSource = context.createBufferSource();
    stereoSource.buffer = stereoBuffer;
    const stereoChannel = mixer.addNode("stereo", stereoSource);
    stereoSource.start();
    await new Promise((r) => setTimeout(r, 120));
    const stereoMeter = stereoChannel.meter();
    stereoSource.stop();
    mixer.remove("stereo");
    const studio = new LiveStudio();
    const project = withLiveAssets(
      decodeProjectFile({
        revision: 0,
        project: { id: "av", settings: { width: 320, height: 180 } },
      }).project,
      {
        ...DEFAULT_LIVE_ASSETS,
        color: "#ff0000",
        overlays: [{ ...item, color: "#00ff00", start: 0.5, duration: 10 }],
      },
    );
    studio.save({ id: "av", name: "A/V", project, expectedRevision: 0 });
    studio.switch({ id: "av", expectedRevision: 1 });
    const output = new LiveStudioOutput(canvas, studio, async () => {
      throw new Error("No sources required");
    });
    await output.render(0);
    const stream = output.recordingStream(mixer.stream);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    console.log("Checking recorded A/V");
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
    await output.render(0);
    const start = context.currentTime;
    mixer.play("beep", tone, { ...DEFAULT_LIVE_AUDIO, syncOffsetMs: 100 }, start + 0.5);
    const framePixels = [];
    while (context.currentTime - start < 1.3) {
      const time = context.currentTime - start;
      await output.render(time);
      framePixels.push({ time, pixel: pixel() });
      await new Promise((r) => setTimeout(r, 25));
    }
    const stopped = new Promise((done) => {
      recorder.onstop = done;
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const array = await blob.arrayBuffer();
    const audio = await context.decodeAudioData(array.slice(0));
    console.log("Checking decoded A/V");
    const decoded = audio.getChannelData(0);
    const audioOnset = decoded.findIndex((v) => Math.abs(v) > 0.04) / audio.sampleRate;
    const video = document.createElement("video");
    video.muted = true;
    video.src = URL.createObjectURL(blob);
    await new Promise((done, reject) => {
      video.onloadeddata = done;
      video.onerror = reject;
    });
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 320;
    sampleCanvas.height = 180;
    const sampleContext = sampleCanvas.getContext("2d");
    let greenAt = null;
    for (let time = 0.3; time <= 0.9; time += 0.025) {
      await new Promise((done) => {
        video.onseeked = done;
        video.currentTime = time;
      });
      sampleContext.drawImage(video, 0, 0);
      const p = sampleContext.getImageData(160, 90, 1, 1).data;
      if (p[1] > 220 && p[0] < 30) {
        greenAt = time;
        break;
      }
    }
    URL.revokeObjectURL(video.src);
    output.close();
    const originalMixRetained = mixer.stream.getAudioTracks()[0].readyState === "live";
    mixer.close();
    clockSource.stop();
    const closedTracks = stream.getTracks().every((t) => t.readyState === "ended");
    await context.close();
    return {
      patterns,
      topPixel,
      reorderedPixel,
      unity,
      quiet,
      muted,
      delayed,
      rumble,
      unfiltered,
      monitorOff,
      monitorOn,
      meter,
      stereoMeter,
      updatedMeter,
      mutedMeter,
      invalidUpdateRejected,
      priorSettingsRetained,
      borrowedTrackRetained,
      originalMixRetained,
      closedTracks,
      audioOnset,
      greenAt,
      measuredOffsetMs: greenAt === null ? null : (audioOnset - greenAt) * 1000,
      frameCount: framePixels.length,
      redFrames: framePixels.filter((f) => f.pixel[0] > 240).length,
      greenFrames: framePixels.filter((f) => f.pixel[1] > 240).length,
      bytes: [...new Uint8Array(array)],
    };
  });
  for (const pattern of result.patterns) {
    assert.equal(pattern.reducedFirst, pattern.reducedSecond);
    if (pattern.background !== "solid")
      assert.notEqual(pattern.first, pattern.second, pattern.background);
  }
  assert.equal(result.topPixel[1], 255);
  assert.equal(result.reorderedPixel[0], 255);
  assert.ok(Math.abs(result.unity.leftRMS - 0.5) < 0.001);
  assert.ok(Math.abs(result.quiet.leftRMS / result.unity.leftRMS - 0.5) < 0.001);
  assert.ok(result.muted.leftRMS < 1e-6);
  assert.equal(result.delayed.onset, 4800);
  assert.ok(result.rumble.leftRMS < result.unfiltered.leftRMS * 0.1);
  assert.ok(result.monitorOff.leftRMS > 0.4 && result.monitorOff.rightRMS < 1e-6);
  assert.ok(result.monitorOn.leftRMS > 0.4 && result.monitorOn.rightRMS > 0.4);
  assert.ok(result.meter.peak > 0.1 && result.meter.peak < 0.3);
  assert.ok(result.stereoMeter.peak > 0.45 && result.stereoMeter.peak < 0.55);
  assert.ok(result.updatedMeter.peak > 0.1 && result.updatedMeter.peak < 0.15);
  assert.ok(result.mutedMeter.peak < 0.001);
  assert.ok(result.invalidUpdateRejected && result.priorSettingsRetained);
  assert.ok(result.borrowedTrackRetained && result.originalMixRetained && result.closedTracks);
  assert.ok(result.redFrames > 0 && result.greenFrames > 0);
  assert.notEqual(result.greenAt, null);
  assert.ok(result.audioOnset > 0);
  assert.ok(
    Math.abs(result.measuredOffsetMs - 100) < 150,
    `Measured A/V delay: ${result.measuredOffsetMs} ms`,
  );
  const { bytes, ...evidence } = result;
  await writeFile(
    resolve(root, "docs/verification/lawn-videorc-assets-audio.webm"),
    new Uint8Array(bytes),
  );
  await writeFile(
    resolve(root, "docs/verification/lawn-videorc-assets-audio.json"),
    JSON.stringify(
      {
        ...evidence,
        recordingBytes: bytes.length,
        browser: browser.version(),
        runtime: "Vite development module harness; real Web Audio, canvas and MediaRecorder",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Live assets/audio passed; measured synthetic A/V offset ${result.measuredOffsetMs.toFixed(1)} ms (configured 100 ms).`,
  );
} finally {
  clearTimeout(timeout);
  await browser?.close();
  await server.close();
}
