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
  assert.ok(address && typeof address !== "string");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/tests/browser/`);
  const result = await page.evaluate(async () => {
    const {
      LiveStudio,
      LiveStudioOutput,
      LiveChat,
      LiveCaptions,
      LiveCompanion,
      decodeProjectFile,
    } = await import("/tests/browser/live-studio-entry.ts");
    const project = decodeProjectFile({
      revision: 0,
      project: {
        id: "p",
        settings: { width: 320, height: 180 },
        videoTracks: [
          {
            id: "v",
            kind: "video",
            clips: [
              { id: "c", duration: 100, content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } } },
            ],
          },
        ],
      },
    }).project;
    const studio = new LiveStudio();
    studio.save({ id: "s", name: "Scene", project, expectedRevision: 0 });
    studio.switch({ id: "s", expectedRevision: 1 });
    const chat = new LiveChat();
    const generation = chat.connect("twitch");
    chat.receive(
      {
        id: "m",
        provider: "twitch",
        authorID: "u",
        author: "Viewer",
        text: "Hello <script>",
        time: 0,
        emotes: [],
      },
      generation,
    );
    chat.highlight("twitch", "m");
    const captions = new LiveCaptions();
    captions.receive(
      { id: "s", revision: 0, final: true, words: [{ text: "Caption fixture", start: 0, end: 2 }] },
      captions.connect(),
      2.1,
    );
    const companion = new LiveCompanion();
    companion.save({ id: "cat", name: "Mochi", avatar: "cat", color: "#38bdf8", animated: true });
    const reader = async () => {
      throw new Error("No media expected");
    };
    const samples = {};
    for (const target of ["preview", "record", "stream"]) {
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      const output = new LiveStudioOutput(canvas, studio, reader, {
        target,
        chat,
        captions,
        companion,
      });
      await output.render(0);
      const context = canvas.getContext("2d");
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
      const before = pixel(280, 100);
      companion.activate("cat");
      await output.render(0.1);
      const active = pixel(280, 100);
      const caption = pixel(20, 160);
      const highlight = pixel(20, 130);
      const media = output.recordingStream();
      const recorder = new MediaRecorder(media, { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.start();
      for (let i = 0; i < 6; i++) {
        await output.render(0.2 + i / 10);
        await new Promise((done) => setTimeout(done, 100));
      }
      const stopped = new Promise((done) => {
        recorder.onstop = done;
      });
      recorder.stop();
      await stopped;
      const video = document.createElement("video");
      video.muted = true;
      const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      try {
        const loaded = new Promise((done, reject) => {
          video.onloadeddata = done;
          video.onerror = reject;
        });
        video.src = url;
        await loaded;
        const seeked = new Promise((done) => {
          video.onseeked = done;
        });
        video.currentTime = 0.2;
        await seeked;
        const decoded = document.createElement("canvas");
        decoded.width = 320;
        decoded.height = 180;
        const ctx = decoded.getContext("2d");
        ctx.drawImage(video, 0, 0);
        const sample = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        samples[target] = {
          before,
          active,
          caption,
          highlight,
          decodedCaption: sample(20, 160),
          decodedHighlight: sample(20, 130),
          decodedCompanion: sample(280, 100),
          bytes: chunks.reduce((n, chunk) => n + chunk.size, 0),
        };
      } finally {
        URL.revokeObjectURL(url);
      }
      chat.clearHighlight();
      companion.deactivate();
      captions.route([]);
      await output.render(1);
      samples[target].clearedCaption = pixel(20, 160);
      samples[target].clearedHighlight = pixel(20, 130);
      samples[target].clearedCompanion = pixel(280, 100);
      output.close();
      samples[target].tracksStopped = media
        .getTracks()
        .every((track) => track.readyState === "ended");
      chat.receive(
        {
          id: target,
          provider: "twitch",
          authorID: "u",
          author: "Viewer",
          text: "Hello",
          time: 0,
          emotes: [],
        },
        generation,
      );
      chat.highlight("twitch", target);
      captions.route(["preview"]);
    }
    return { samples, captionStatus: captions.status(), chatStatus: chat.status() };
  });
  const red = (pixel) => pixel[0] > 220 && pixel[1] < 30;
  const dark = (pixel) => pixel[0] < 40 && pixel[1] < 50;
  for (const [target, sample] of Object.entries(result.samples)) {
    assert.ok(
      red(sample.before) && sample.active[2] > 200,
      `${target}: explicit companion activation`,
    );
    assert.ok(sample.decodedCompanion[2] > 180, `${target}: decoded companion`);
    assert.ok(dark(sample.highlight) && dark(sample.decodedHighlight), `${target}: chat highlight`);
    assert.ok(
      target === "preview"
        ? dark(sample.caption) && dark(sample.decodedCaption)
        : red(sample.caption) && red(sample.decodedCaption),
      `${target}: caption routing`,
    );
    assert.ok(
      red(sample.clearedCaption) && red(sample.clearedHighlight) && red(sample.clearedCompanion),
      `${target}: revocation`,
    );
    assert.ok(sample.tracksStopped && sample.bytes > 100);
  }
  await writeFile(
    resolve(root, "docs/verification/lawn-videorc-live-engagement.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "Live engagement: three output targets, decoded VP8 overlays, activation and teardown passed.",
  );
} finally {
  await browser?.close();
  await server.close();
}
