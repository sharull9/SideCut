import { chromium, firefox, webkit } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { resolve, join, relative, extname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  publicRoot = join(root, "apps/web/.output/public");
const temporary = await mkdtemp(join(tmpdir(), "sidecut-browser-"));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      publicRoot,
      "." + decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname),
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
    res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const results = [];
const evidencePrefix = process.env.SIDECUT_VERIFICATION_PREFIX ?? "phase-136";
assert.match(evidencePrefix, /^[a-z0-9-]+$/);
const selectedEngine = process.env.SIDECUT_VERIFICATION_ENGINE;
assert.ok(selectedEngine == null || ["chromium", "firefox", "webkit"].includes(selectedEngine));
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (selectedEngine && selectedEngine !== name) continue;
    let browser, page;
    const result = {
      engine: name,
      platform: process.platform,
      production: true,
      source: "secure loopback production server",
      journey: {},
      errors: [],
    };
    try {
      browser = await engine.launch({ headless: true });
      result.version = browser.version();
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1280, height: 900 },
      });
      page = await context.newPage();
      page.on("pageerror", (error) => result.errors.push(error.message));
      page.setDefaultTimeout(20000);
      await page.goto(url);
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "Open project" && !b.disabled,
        ),
      );
      await page.locator('[data-testid="project-name"]').waitFor();
      result.capabilities = await page.evaluate(() => ({
        secureContext: isSecureContext,
        indexedDB: typeof indexedDB !== "undefined",
        webLocks: Boolean(navigator.locks),
        fileSystemPicker: typeof showDirectoryPicker !== "undefined",
        VideoEncoder: typeof VideoEncoder,
        AudioEncoder: typeof AudioEncoder,
        AudioBuffer: typeof AudioBuffer,
        webGPU: Boolean(navigator.gpu),
        persistentStorage: Boolean(navigator.storage?.persist),
      }));
      const fixture = {
        revision: 0,
        project: {
          id: `browser-${name}`,
          name: `Browser ${name}`,
          settings: { width: 320, height: 180 },
          videoTracks: [
            {
              id: "picture",
              kind: "video",
              name: "Picture",
              clips: [
                {
                  id: "solid",
                  content: { solid: { color: { r: 0.1, g: 0.4, b: 0.7, a: 1 } } },
                  duration: 1,
                },
              ],
            },
          ],
          audioTracks: [{ id: "voice", kind: "audio", name: "Voice" }],
        },
      };
      await page
        .getByLabel("Project, archive, EDL recipe, or Filmora file", { exact: true })
        .setInputFiles({
          name: "fixture.tandem",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(fixture)),
        });
      await page
        .getByTestId("project-name")
        .filter({ hasText: `Browser ${name}` })
        .waitFor();
      result.journey.import = true;
      await page.getByRole("button", { name: "Select clip solid", exact: true }).click();
      await page.getByRole("button", { name: "Select clip solid", exact: true }).focus();
      await page.keyboard.press("Control+c");
      await page.getByRole("slider", { name: "Timeline playhead", exact: true }).focus();
      await page.keyboard.press("End");
      await page.keyboard.press("Control+v");
      await page.waitForFunction(() => document.querySelectorAll(".editor-clip-body").length === 2);
      result.journey.edit = true;
      await page.getByText("Saved in browser", { exact: true }).waitFor();
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll(".editor-clip-body").length === 2);
      result.journey.reopen = true;
      const reader = await context.newPage();
      reader.setDefaultTimeout(20000);
      reader.on("pageerror", (error) => result.errors.push(`Read-only tab: ${error.message}`));
      await reader.goto(url);
      await reader.locator('.editor-session-label[data-state="read-only"]').waitFor();
      await reader.locator(".editor-timeline-scroll").focus();
      await reader.keyboard.press("Home");
      await reader.keyboard.press("ArrowRight");
      assert.equal(await reader.getByTestId("timeline-timecode").textContent(), "00:00:00:01");
      await reader.keyboard.press("Control+a");
      assert.equal(await reader.locator('.editor-clip[data-selected="true"]').count(), 2);
      await reader.keyboard.press("Delete");
      assert.equal(await reader.locator(".editor-clip-body").count(), 2);
      await reader.keyboard.press("s");
      assert.equal(
        await reader
          .getByRole("button", { name: "Toggle snapping", exact: true })
          .getAttribute("aria-pressed"),
        "false",
      );
      await reader.close();
      await page.bringToFront();
      result.journey.readOnlyKeyboard = {
        navigation: true,
        selection: true,
        deleteBlocked: true,
        snappingViewToggle: true,
      };
      const pcm = Buffer.alloc(44 + 9600 * 2);
      pcm.write("RIFF");
      pcm.writeUInt32LE(pcm.length - 8, 4);
      pcm.write("WAVEfmt ", 8);
      pcm.writeUInt32LE(16, 16);
      pcm.writeUInt16LE(1, 20);
      pcm.writeUInt16LE(1, 22);
      pcm.writeUInt32LE(48000, 24);
      pcm.writeUInt32LE(96000, 28);
      pcm.writeUInt16LE(2, 32);
      pcm.writeUInt16LE(16, 34);
      pcm.write("data", 36);
      pcm.writeUInt32LE(pcm.length - 44, 40);
      for (let i = 0; i < 9600; i++)
        pcm.writeInt16LE(Math.round(Math.sin((i * Math.PI * 880) / 48000) * 5000), 44 + i * 2);
      await page
        .getByLabel("Local media files", { exact: true })
        .setInputFiles({ name: "source.wav", mimeType: "audio/wav", buffer: pcm });
      await page.getByRole("button", { name: "Place source.wav", exact: true }).waitFor();
      await page.getByRole("slider", { name: "Timeline playhead", exact: true }).focus();
      await page.keyboard.press("Home");
      await page.getByRole("button", { name: "Place source.wav", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll(".editor-clip-body").length === 3);
      result.journey.audioImport = true;
      const projectDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download project", exact: true }).click();
      const project = await projectDownload;
      const projectPath = join(temporary, `${name}.tandem`);
      await project.saveAs(projectPath);
      const saved = JSON.parse(await readFile(projectPath, "utf8"));
      assert.equal(saved.project.videoTracks[0].clips.length, 2);
      result.journey.save = true;
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("button", { name: "Queue export", exact: true }).click();
      await page.waitForFunction(
        () =>
          Boolean(document.querySelector('[download$=".webm"]')) ||
          Boolean(document.querySelector('[role="alert"]')),
      );
      const webm = page.locator('[download$=".webm"]');
      if (await webm.count()) {
        const download = page.waitForEvent("download");
        await webm.click();
        const output = await download;
        const path = join(temporary, `${name}.webm`);
        await output.saveAs(path);
        const bytes = await readFile(path);
        assert.equal(bytes.readUInt32BE(0), 0x1a45dfa3);
        assert.ok(bytes.includes(Buffer.from("A_OPUS")));
        result.journey.webm = {
          status: "passed",
          bytes: bytes.length,
          video: "vp8",
          audio: "opus",
        };
      } else
        result.journey.webm = {
          status: "unsupported",
          message: await page.locator('[role="alert"]').allTextContents(),
        };
      await page.getByLabel("Export preset", { exact: true }).selectOption("wav");
      await page.getByRole("button", { name: "Queue export", exact: true }).click();
      await page.waitForFunction(
        () =>
          Boolean(document.querySelector('[download$=".wav"]')) ||
          Boolean(document.querySelector('.editor-export-list li:last-child [role="alert"]')),
      );
      if (await page.locator('[download$=".wav"]').count()) {
        const wavDownload = page.waitForEvent("download");
        await page.locator('[download$=".wav"]').click();
        const wav = await wavDownload,
          path = join(temporary, `${name}.wav`);
        await wav.saveAs(path);
        const bytes = await readFile(path);
        assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
        assert.equal(bytes.length, 384044);
        result.journey.wav = { status: "passed", bytes: bytes.length };
      } else
        result.journey.wav = {
          status: "unsupported",
          message: await page
            .locator('.editor-export-list li:last-child [role="alert"]')
            .allTextContents(),
        };
      await page.keyboard.press("Escape");
      const archiveDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Archive project", exact: true }).click();
      const archive = await archiveDownload;
      await archive.saveAs(join(temporary, `${name}.sidecut`));
      result.journey.archive = true;
      await page
        .getByLabel("Project, archive, EDL recipe, or Filmora file", { exact: true })
        .setInputFiles(join(temporary, `${name}.sidecut`));
      await page.waitForFunction(() => document.querySelectorAll(".editor-clip-body").length === 3);
      result.journey.archiveReopen = true;
      await mkdir(join(root, "docs/verification"), { recursive: true });
      await page.screenshot({
        path: join(root, `docs/verification/${evidencePrefix}-${name}.png`),
      });
      result.accepted = result.journey.webm.status === "passed" && result.errors.length === 0;
    } catch (error) {
      result.accepted = false;
      result.errors.push(error.message);
      if (page) {
        result.alerts = await page
          .locator('[role="alert"]')
          .allTextContents()
          .catch(() => []);
        await page
          .screenshot({ path: join(root, `docs/verification/${evidencePrefix}-${name}.png`) })
          .catch(() => {});
      }
    } finally {
      await browser?.close();
      results.push(result);
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  }
  await writeFile(
    join(root, `docs/verification/${evidencePrefix}-browsers.json`),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        results,
        limits: [
          "Loopback production server; public hosted deployment not tested",
          "Playwright WebKit is not Safari on macOS/iOS",
          "No first-run model downloads, storage pressure, or real directory-picker permissions tested",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  if (results.some((r) => !r.accepted)) process.exitCode = 1;
} finally {
  await new Promise((done) => server.close(done));
  assert.ok(temporary.startsWith(join(tmpdir(), "sidecut-browser-")));
  await rm(temporary, { recursive: true, force: true });
}
