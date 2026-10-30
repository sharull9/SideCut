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
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/tests/browser/`);
  const result = await page.evaluate(async () => {
    const { LiveStudio, LiveStudioOutput, decodeProjectFile } =
      await import("/tests/browser/live-studio-entry.ts");
    const project = (green) =>
      decodeProjectFile({
        revision: 0,
        project: {
          id: "p",
          settings: { width: 320, height: 180 },
          videoTracks: [
            {
              id: "v",
              kind: "video",
              clips: [
                {
                  id: "c",
                  duration: 100,
                  content: { solid: { color: { r: green ? 0 : 1, g: green ? 1 : 0, b: 0, a: 1 } } },
                },
              ],
            },
          ],
        },
      }).project;
    const studio = new LiveStudio();
    studio.save({ id: "red", name: "Red", project: project(false), expectedRevision: 0 });
    studio.save({ id: "green", name: "Green", project: project(true), expectedRevision: 1 });
    studio.switch({ id: "red", expectedRevision: 2 });
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const output = new LiveStudioOutput(canvas, studio, async () => {
      throw new Error("No media required");
    });
    const red = await output.render(0);
    const pixel = () => [...canvas.getContext("2d").getImageData(160, 90, 1, 1).data];
    const redPixel = pixel();
    const stream = output.recordingStream();
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
    for (let i = 0; i < 6; i++) {
      await output.render(i / 10);
      await new Promise((r) => setTimeout(r, 100));
    }
    studio.switch({ id: "green", expectedRevision: 3 });
    const green = await output.render(1);
    const greenPixel = pixel();
    for (let i = 0; i < 6; i++) {
      await output.render(1 + i / 10);
      await new Promise((r) => setTimeout(r, 100));
    }
    const controller = new AbortController();
    controller.abort();
    let aborted = false;
    try {
      await output.render(2, controller.signal);
    } catch {
      aborted = true;
    }
    const afterAbort = output.currentFrame;
    const stopped = new Promise((done) => {
      recorder.onstop = done;
    });
    recorder.stop();
    await stopped;
    const bytes = [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
    const decoded = document.createElement("video");
    decoded.muted = true;
    decoded.src = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
    const loaded = new Promise((done, reject) => {
      decoded.onloadeddata = done;
      decoded.onerror = reject;
    });
    await loaded;
    const decodedCanvas = document.createElement("canvas");
    decodedCanvas.width = 320;
    decodedCanvas.height = 180;
    const context = decodedCanvas.getContext("2d");
    const sample = async (time) => {
      await new Promise((done) => {
        decoded.onseeked = done;
        decoded.currentTime = time;
      });
      context.drawImage(decoded, 0, 0);
      return [...context.getImageData(160, 90, 1, 1).data];
    };
    const decodedRed = await sample(0.2);
    const decodedGreen = await sample(0.9);
    URL.revokeObjectURL(decoded.src);
    const inFlight = output.render(3);
    const overlapSkipped = (await output.render(3.1)) === null;
    studio.switch({ id: "red", expectedRevision: 4 });
    const staleDiscarded = (await inFlight) === null;
    const afterSwitch = await output.render(3.2);
    output.close();
    return {
      red,
      green,
      redPixel,
      greenPixel,
      decodedRed,
      decodedGreen,
      aborted,
      afterAbort,
      overlapSkipped,
      staleDiscarded,
      afterSwitch,
      tracksStopped: stream.getTracks().every((t) => t.readyState === "ended"),
      bytes,
    };
  });
  assert.equal(result.red.sceneId, "red");
  assert.equal(result.green.sceneId, "green");
  assert.equal(result.red.commitRevision, 3);
  assert.equal(result.green.commitRevision, 4);
  assert.ok(result.redPixel[0] > 240 && result.redPixel[1] < 10);
  assert.ok(result.greenPixel[1] > 240 && result.greenPixel[0] < 10);
  assert.ok(result.decodedRed[0] > 220 && result.decodedRed[1] < 30);
  assert.ok(result.decodedGreen[1] > 220 && result.decodedGreen[0] < 30);
  assert.ok(result.aborted && result.tracksStopped);
  assert.ok(result.overlapSkipped && result.staleDiscarded);
  assert.equal(result.afterSwitch.sceneId, "red");
  assert.equal(result.afterSwitch.commitRevision, 5);
  assert.equal(result.afterAbort.sceneId, "green");
  assert.ok(result.bytes.length > 100);
  await writeFile(
    resolve(root, "docs/verification/lawn-videorc-scene-switch.webm"),
    new Uint8Array(result.bytes),
  );
  const { bytes, ...evidence } = result;
  await writeFile(
    resolve(root, "docs/verification/lawn-videorc-scene-switch.json"),
    JSON.stringify(
      {
        ...evidence,
        browser: browser.version(),
        recordingBytes: bytes.length,
        runtime: "Vite development module harness; real canvas, MediaRecorder and video decode",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Live scene revision, canvas pixels and decoded recording checks passed.");
} finally {
  await browser?.close();
  await server.close();
}
