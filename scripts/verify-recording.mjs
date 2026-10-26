import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, relative, extname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  publicRoot = join(root, "apps/web/.output/public");
const requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
const probePath = requireDesktop("ffprobe-static").path;
const temporary = await mkdtemp(join(tmpdir(), "sidecut-recording-"));
const result = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  production: true,
  syntheticDevices: true,
  recordings: [],
  checks: {},
  errors: [],
  accepted: false,
};
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      publicRoot,
      "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
    );
    const within = relative(publicRoot, path);
    if (within.startsWith("..") || isAbsolute(within)) {
      res.writeHead(403).end();
      return;
    }
    let file = path,
      data;
    try {
      data = await readFile(file);
    } catch {
      file = join(publicRoot, "_shell.html");
      data = await readFile(file);
    }
    res
      .writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" })
      .end(data);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  result.browser = browser.version();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(url);
  await page.getByTestId("project-name").waitFor();
  await page.getByText("Saved in browser", { exact: true }).waitFor();
  await page
    .getByLabel("Project, archive, EDL recipe, or Filmora file", { exact: true })
    .setInputFiles({
      name: "recording-fixture.tandem",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          revision: 0,
          project: {
            id: "recording-fixture",
            name: "Recording fixture",
            settings: { width: 320, height: 180 },
            videoTracks: [{ id: "picture", kind: "video", name: "Picture", targeted: true }],
            audioTracks: [{ id: "sound", kind: "audio", name: "Sound", targeted: true }],
          },
        }),
      ),
    });
  await page.getByTestId("project-name").filter({ hasText: "Recording fixture" }).waitFor();
  const openRecording = async () => {
    const summary = page.locator("summary").filter({ hasText: /^Record$/ });
    await summary.evaluate((element) => {
      element.parentElement.open = true;
    });
  };
  await openRecording();
  const reader = await context.newPage();
  await reader.goto(url);
  await reader.locator('.editor-session-label[data-state="read-only"]').waitFor();
  await reader
    .locator("summary")
    .filter({ hasText: /^Record$/ })
    .evaluate((element) => {
      element.parentElement.open = true;
    });
  assert.equal(
    await reader.getByRole("button", { name: "Start recording", exact: true }).isDisabled(),
    true,
  );
  await reader.close();
  result.checks.readOnlyCannotStart = true;

  for (const source of ["camera", "microphone", "screen"]) {
    await page.locator("#recording-source").selectOption(source);
    if (source === "camera") await page.getByLabel("Include microphone", { exact: true }).check();
    if (source === "screen") {
      await page.getByLabel("Include microphone", { exact: true }).uncheck();
      // Real MediaRecorder/OPFS, with a synthetic display stream instead of an OS picker.
      await page.evaluate(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const drawingContext = canvas.getContext("2d");
          let frame = 0;
          const timer = setInterval(() => {
            drawingContext.fillStyle = frame++ % 2 ? "#29a" : "#e84";
            drawingContext.fillRect(0, 0, 320, 180);
          }, 33);
          const stream = canvas.captureStream(30);
          stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(timer));
          globalThis.captureTestScreen = stream;
          return stream;
        };
      });
    }
    await page.getByRole("button", { name: "Start recording", exact: true }).click();
    await page.getByRole("button", { name: "Stop recording", exact: true }).waitFor();
    // Switching the side panel must not stop capture or lose the completed file.
    if (source === "camera") {
      await page.getByRole("tab", { name: "Comments", exact: true }).click();
      await page.getByRole("tab", { name: "Media", exact: true }).click();
      await openRecording();
      await page.getByRole("button", { name: "Stop recording", exact: true }).waitFor();
      result.checks.survivesPanelSwitch = true;
    }
    await page.waitForFunction(() => document.body.textContent.includes("Recording · 0:02"));
    if (source === "screen") {
      await page.evaluate(() => {
        const track = globalThis.captureTestScreen.getVideoTracks()[0];
        track.stop();
        track.dispatchEvent(new Event("ended"));
      });
      result.checks.syntheticScreenEndedSaves = true;
    } else await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    await page.getByRole("button", { name: "Add recording to project", exact: true }).waitFor();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download recording", exact: true }).click();
    const download = await downloadEvent;
    const path = join(temporary, `${source}.webm`);
    await download.saveAs(path);
    const probe = spawnSync(
      probePath,
      ["-v", "error", "-count_packets", "-show_streams", "-of", "json", path],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const streams = JSON.parse(probe.stdout).streams;
    if (source !== "screen")
      assert.ok(
        streams.some(
          (stream) => stream.codec_name === "opus" && Number(stream.nb_read_packets) > 0,
        ),
      );
    if (source !== "microphone")
      assert.ok(
        streams.some((stream) => stream.codec_name === "vp8" && Number(stream.nb_read_packets) > 0),
      );
    result.recordings.push({
      source,
      bytes: (await readFile(path)).length,
      streams: streams.map((stream) => ({
        codec: stream.codec_name,
        packets: stream.nb_read_packets,
        width: stream.width,
        height: stream.height,
      })),
    });
    await page.getByRole("button", { name: "Add recording to project", exact: true }).click();
    const row = page.getByTestId("media-item").filter({ hasText: download.suggestedFilename() });
    await row.getByRole("img", { name: "On this device", exact: true }).waitFor();
    await page.getByRole("slider", { name: "Timeline playhead", exact: true }).focus();
    await page.keyboard.press("End");
    await row
      .getByRole("button", { name: `Place ${download.suggestedFilename()}`, exact: true })
      .click();
    await page.getByText("Saved in browser", { exact: true }).waitFor();
  }
  assert.equal(await page.locator(".editor-clip-body").count(), 3);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".editor-clip-body").length === 3);
  assert.equal(await page.getByTestId("media-item").count(), 3);
  result.checks.recordImportPlaceReload = true;
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Export preset", { exact: true }).selectOption("webm");
  await page.getByRole("button", { name: "Queue export", exact: true }).click();
  await page.locator('[download$=".webm"]').waitFor();
  const exportEvent = page.waitForEvent("download");
  await page.locator('[download$=".webm"]').click();
  const exported = await exportEvent;
  const exportPath = join(temporary, "edited-recordings.webm");
  await exported.saveAs(exportPath);
  const exportedProbe = spawnSync(
    probePath,
    ["-v", "error", "-count_packets", "-show_streams", "-of", "json", exportPath],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(exportedProbe.status, 0, exportedProbe.stderr);
  const exportedStreams = JSON.parse(exportedProbe.stdout).streams;
  assert.ok(
    exportedStreams.some(
      (stream) => stream.codec_name === "vp8" && Number(stream.nb_read_packets) > 0,
    ),
  );
  assert.ok(
    exportedStreams.some(
      (stream) => stream.codec_name === "opus" && Number(stream.nb_read_packets) > 0,
    ),
  );
  result.checks.editableRecordingExport = {
    bytes: (await readFile(exportPath)).length,
    codecs: exportedStreams.map((stream) => stream.codec_name),
  };
  await page.keyboard.press("Escape");
  await openRecording();
  await page.locator("#recording-source").selectOption("microphone");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
  await page.getByRole("button", { name: "Start recording", exact: true }).waitFor();
  assert.equal(await page.getByTestId("media-item").count(), 3);
  result.checks.cancelAddsNoMedia = true;
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Recording · 0:01"));
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Add recording to project", exact: true }).waitFor();
  await page
    .getByLabel("Project, archive, EDL recipe, or Filmora file", { exact: true })
    .setInputFiles({
      name: "replacement.tandem",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ revision: 0, project: { id: "replacement", name: "Replacement" } }),
      ),
    });
  await page.getByTestId("project-name").filter({ hasText: "Replacement" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Add recording to project", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("link", { name: "Download recording", exact: true }).count(),
    1,
  );
  assert.equal(await page.getByTestId("media-item").count(), 0);
  await page.getByRole("button", { name: "Discard recording", exact: true }).click();
  result.checks.replacementProjectPreservesDownloadAndBlocksImport = true;
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied fixture", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Permission denied fixture" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Start recording", exact: true }).isEnabled(),
    true,
  );
  result.checks.permissionFailureAllowsRetry = true;
  await page.waitForFunction(async () => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("sidecut-recordings");
    for await (const name of directory.keys()) if (name.length) return false;
    return true;
  });
  const staged = await page.evaluate(async () => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("sidecut-recordings");
    const entries = [];
    for await (const name of directory.keys()) entries.push(name);
    return entries;
  });
  assert.deepEqual(staged, []);
  result.checks.stagedFilesCleaned = true;
  assert.deepEqual(result.errors, []);
  result.accepted = true;
} catch (error) {
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  assert.ok(temporary.startsWith(join(tmpdir(), "sidecut-recording-")));
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    join(root, "docs/verification/lawn-videorc-capture-runtime.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(result) + "\n");
}
