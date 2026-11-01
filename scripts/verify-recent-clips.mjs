import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";

const root = pathResolve(import.meta.dirname, "..");
const server = await createServer({
  configFile: false,
  root,
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { noDiscovery: true },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/tests/browser/`);
  const result = await page.evaluate(async () => {
    const { RecentClips } = await import("/tests/browser/live-studio-entry.ts");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    let green = false;
    const timer = setInterval(() => {
      context.fillStyle = green ? "#00ff00" : "#ff0000";
      context.fillRect(0, 0, 320, 180);
    }, 33);
    const video = canvas.captureStream(30);
    const audioContext = new AudioContext();
    await audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const destination = audioContext.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    const clips = new RecentClips();
    try {
      // Deliberately supply audio separately; a video-only source must not gate audio setup.
      clips.arm({ video, audio: destination.stream });
      clips.mark("Start", "clip-start");
      await wait(5700);
      green = true;
      clips.mark("Switch to green");
      await wait(5500);
      clips.mark("End", "clip-end");
      const saved = await clips.save(30);
      const stillArmed = clips.status.armed;
      const decoded = document.createElement("video");
      decoded.muted = true;
      const url = URL.createObjectURL(saved.file);
      decoded.src = url;
      await new Promise((resolve, reject) => {
        decoded.onloadeddata = resolve;
        decoded.onerror = () => reject(new Error("Clip did not decode"));
      });
      const sample = async (time) => {
        await new Promise((resolve) => {
          decoded.onseeked = resolve;
          decoded.currentTime = time;
        });
        context.drawImage(decoded, 0, 0);
        return [...context.getImageData(160, 90, 1, 1).data];
      };
      const red = await sample(1);
      const greenPixel = await sample(8);
      URL.revokeObjectURL(url);
      const audio = await audioContext.decodeAudioData(await saved.file.arrayBuffer());
      const samples = audio.getChannelData(0);
      const rms = (start, end) => {
        const slice = samples.subarray(start * audio.sampleRate, end * audio.sampleRate);
        return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
      };
      const audioEarly = rms(1, 2),
        audioLate = rms(8, 9);
      // stop() does not dispatch ended in browsers; inspect readyState when rearming.
      await clips.stop();
      const borrowedLive = [...video.getTracks(), ...destination.stream.getTracks()].every(
        (track) => track.readyState === "live",
      );
      clips.arm({ video });
      video.getVideoTracks()[0].dispatchEvent(new Event("ended"));
      const failed = clips.status;
      await clips.stop();
      clips.arm({ video });
      // Old borrowed audio is no longer selected and must not trip the new arm's latch.
      destination.stream.getAudioTracks()[0].dispatchEvent(new Event("ended"));
      const rearmed = clips.status;
      await wait(600);
      const videoOnly = await clips.save(60);
      const aborted = new AbortController();
      aborted.abort();
      let abortRejected = false;
      try {
        await clips.save(30, aborted.signal);
      } catch {
        abortRejected = true;
      }
      // Track.stop() changes readyState without sending an ended event.
      video.getVideoTracks()[0].stop();
      await wait(350);
      const silentStopDetected = !clips.status.armed && Boolean(clips.status.failure);
      await clips.stop();
      let stoppedRejected = false;
      try {
        clips.arm({ video });
      } catch {
        stoppedRejected = true;
      }
      return {
        bytes: [...new Uint8Array(await saved.file.arrayBuffer())],
        duration: saved.end - saved.start,
        decodedAudioDuration: audio.duration,
        marks: saved.marks,
        red,
        greenPixel,
        audioEarly,
        audioLate,
        stillArmed,
        borrowedLive,
        failed,
        rearmed,
        stoppedRejected,
        videoOnlyBytes: videoOnly.file.size,
        abortRejected,
        silentStopDetected,
      };
    } finally {
      await clips.stop();
      clearInterval(timer);
      video.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      oscillator.stop();
      await audioContext.close();
    }
  });
  assert.ok(result.duration >= 10 && result.duration < 14);
  assert.ok(Math.abs(result.decodedAudioDuration - result.duration) < 0.5);
  assert.ok(result.red[0] > 220 && result.red[1] < 30);
  assert.ok(result.greenPixel[1] > 220 && result.greenPixel[0] < 30);
  assert.ok(result.audioEarly > 0.1 && result.audioLate > 0.1);
  assert.deepEqual(
    result.marks.map((mark) => mark.kind),
    ["clip-start", "marker", "clip-end"],
  );
  assert.ok(result.stillArmed && result.borrowedLive && result.stoppedRejected);
  assert.ok(result.abortRejected && result.silentStopDetected);
  assert.ok(!result.failed.armed && result.failed.failure);
  assert.ok(result.rearmed.armed && result.rearmed.failure === null);
  assert.ok(result.videoOnlyBytes > 100);
  const { bytes, ...evidence } = result;
  await writeFile(
    pathResolve(root, "docs/verification/lawn-videorc-recent-clips.webm"),
    new Uint8Array(bytes),
  );
  await writeFile(
    pathResolve(root, "docs/verification/lawn-videorc-recent-clips.json"),
    JSON.stringify(
      {
        ...evidence,
        recordingBytes: bytes.length,
        browser: browser.version(),
        runtime: "Vite module harness; synthetic canvas/audio; real MediaRecorder and WebM decode",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Recent clip remux, decoded picture/audio, source recovery and rearm passed.");
} finally {
  await browser?.close();
  await server.close();
}
