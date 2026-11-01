import assert from "node:assert/strict";
import { createServer as createViteServer } from "vite-plus";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, extname } from "node:path";
const root = resolve(import.meta.dirname, "..");
const collectionFixture = JSON.parse(
  await readFile(join(root, "tests/fixtures/obs/collection.json"), "utf8"),
);
const profileText = await readFile(join(root, "tests/fixtures/obs/basic.ini"), "utf8");
const pngBytes = [...(await readFile(join(root, "tests/fixtures/obs/logo.png")))];
const publicRoot = join(root, "apps/web/.output/public");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};
const production = createServer(async (request, response) => {
  try {
    let path = resolve(
      publicRoot,
      "." + decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname),
    );
    const rel = relative(publicRoot, path);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      response.writeHead(403).end();
      return;
    }
    let data;
    try {
      data = await readFile(path);
    } catch {
      path = join(publicRoot, "_shell.html");
      data = await readFile(path);
    }
    response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(500).end();
  }
});
const vite = await createViteServer({
  configFile: false,
  root,
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { noDiscovery: true },
});
let browser;
try {
  await vite.listen();
  await new Promise((done) => production.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/browser/`);
  const result = await page.evaluate(
    async ({ fixture, profile, png }) => {
      const { importOBS, LiveStudio, LiveStudioOutput, LocalMediaReader, encodeProjectFile } =
        await import("/tests/browser/obs-import-entry.ts");
      const images = new Map([["Logo", { path: "assets/logo.png", width: 16, height: 16 }]]);
      const imported = importOBS(fixture, { profile, images, duration: 3 });
      const studio = LiveStudio.restore(imported.file.project.metadata["sidecut.liveStudio"]);
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      const reader = await LocalMediaReader.open(
        new File([new Uint8Array(png)], "logo.png", { type: "image/png" }),
        "image",
      );
      const output = new LiveStudioOutput(canvas, studio, async () => reader);
      await output.render(0);
      const sample = (context) => ({
        background: [...context.getImageData(150, 100, 1, 1).data],
        panel: [...context.getImageData(30, 40, 1, 1).data],
        outsideCrop: [...context.getImageData(110, 40, 1, 1).data],
        logo: [...context.getImageData(210, 30, 1, 1).data],
        hidden: [...context.getImageData(10, 10, 1, 1).data],
      });
      const pixels = sample(canvas.getContext("2d"));
      const stream = output.recordingStream();
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.start();
      for (let i = 0; i < 8; i++) {
        await output.render(i / 10);
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
      let decoded;
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
        video.currentTime = 0.3;
        await seeked;
        const buffer = document.createElement("canvas");
        buffer.width = 320;
        buffer.height = 180;
        const context = buffer.getContext("2d");
        context.drawImage(video, 0, 0);
        decoded = sample(context);
      } finally {
        URL.revokeObjectURL(url);
      }
      studio.switch({ id: "obs_scene_0", expectedRevision: studio.currentRevision });
      await output.render(1);
      const other = [...canvas.getContext("2d").getImageData(160, 90, 1, 1).data];
      output.close();
      reader.close();
      const rotated = structuredClone(fixture);
      Object.assign(rotated.sources.find((s) => s.name === "Main").settings.items[1], {
        pos: { x: 160, y: 90 },
        rot: 90,
        align: 0,
      });
      const rotationImport = importOBS(rotated, { profile });
      const rotationStudio = LiveStudio.restore(
        rotationImport.file.project.metadata["sidecut.liveStudio"],
      );
      const rotationCanvas = document.createElement("canvas");
      const rotationOutput = new LiveStudioOutput(rotationCanvas, rotationStudio, async () => {
        throw new Error("No image expected");
      });
      await rotationOutput.render(0);
      const rotationContext = rotationCanvas.getContext("2d");
      const rotatedInside = [...rotationContext.getImageData(160, 120, 1, 1).data];
      const rotatedOutside = [...rotationContext.getImageData(195, 90, 1, 1).data];
      rotationOutput.close();
      const browserProject = importOBS(fixture, { profile, duration: 3 }).file;
      return {
        pixels,
        decoded,
        other,
        rotatedInside,
        rotatedOutside,
        report: imported.report,
        tracksStopped: stream.getTracks().every((t) => t.readyState === "ended"),
        browserProject: JSON.parse(encodeProjectFile(browserProject)),
        encodedBytes: chunks.reduce((n, chunk) => n + chunk.size, 0),
      };
    },
    { fixture: collectionFixture, profile: profileText, png: pngBytes },
  );
  const red = (pixel) => pixel[0] > 220 && pixel[1] < 30 && pixel[2] < 30;
  const green = (pixel) => pixel[1] > 220 && pixel[0] < 30;
  const blue = (pixel) => pixel[2] > 220 && pixel[0] < 30;
  for (const pixels of [result.pixels, result.decoded]) {
    assert.ok(
      red(pixels.background) && red(pixels.outsideCrop) && red(pixels.hidden),
      "background, source crop and hidden layers",
    );
    assert.ok(green(pixels.panel) && blue(pixels.logo), "layer order and actual PNG decoding");
  }
  assert.ok(blue(result.other), "saved scene switching");
  assert.ok(
    green(result.rotatedInside) && red(result.rotatedOutside),
    "rotated crop and center anchor",
  );
  assert.ok(result.tracksStopped && result.encodedBytes > 100);
  await page.goto(`http://127.0.0.1:${production.address().port}/`);
  await page.getByTestId("project-name").waitFor();
  await page.getByText("Saved in browser", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const input = document.querySelector(
      'input[aria-label="Project, archive, EDL recipe, or Filmora file"]',
    );
    return input && !input.disabled;
  });
  await page
    .getByLabel("Project, archive, EDL recipe, or Filmora file", { exact: true })
    .setInputFiles({
      name: "obs-import.tandem",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(result.browserProject)),
    });
  await page
    .getByTestId("project-name")
    .filter({ hasText: "OBS fixture" })
    .waitFor()
    .catch(async (error) => {
      console.error(await page.locator(".editor-notice").allTextContents());
      throw error;
    });
  await page.locator(".editor-notice").filter({ hasText: "browser_source" }).waitFor();
  const visibleDiagnostics = await page
    .locator(".editor-notice")
    .filter({ hasText: "browser_source" })
    .innerText();
  await page.getByText("Saved in browser", { exact: true }).waitFor();
  await page.reload();
  await page.getByTestId("project-name").filter({ hasText: "OBS fixture" }).waitFor();
  const { browserProject: _browserProject, ...evidence } = result;
  await writeFile(
    join(root, "docs/verification/lawn-videorc-obs-import.json"),
    JSON.stringify(
      {
        ...evidence,
        productionEditor: { opened: true, visibleDiagnostics, reload: true },
        engine: browser.version(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "OBS import: decoded layers/crop/rotation/scene switching, production diagnostics and reload passed.",
  );
} finally {
  await browser?.close();
  await vite.close();
  production.closeAllConnections();
  await new Promise((done) => production.close(done));
}
