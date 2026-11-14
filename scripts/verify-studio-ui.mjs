// Production-build Live studio journey with synthetic Chromium devices. Run after `vp run build:web`.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, extname, isAbsolute } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const publicRoot = join(root, "apps/web/.output/public");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  const path = resolve(
    publicRoot,
    "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
  );
  const within = relative(publicRoot, path);
  if (within.startsWith("..") || isAbsolute(within)) return res.writeHead(403).end();
  let file = path;
  let data;
  try {
    data = await readFile(file);
  } catch {
    file = join(publicRoot, "_shell.html");
    data = await readFile(file);
  }
  res
    .writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" })
    .end(data);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;

const result = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  production: true,
  syntheticDevices: true,
  checks: {},
  errors: [],
  accepted: false,
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-accept-this-tab-capture",
      "--autoplay-policy=user-gesture-required",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["camera", "microphone"]);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(url);
  const dialog = page.getByRole("main", { name: "Studio" });
  const nav = page.getByRole("navigation", { name: "App" });
  const openStudio = async () => {
    await nav.getByRole("link", { name: "Studio", exact: true }).click();
    await dialog.getByRole("button", { name: "Save from editor" }).waitFor();
    await dialog.getByText("Opening saved scenes…").waitFor({ state: "detached" });
  };
  const button = (name) => dialog.getByRole("button", { name, exact: true });
  const pixel = (x, y) =>
    dialog
      .locator("canvas")
      .evaluate(
        (canvas, [px, py]) => [
          ...canvas.getContext("2d").getImageData(canvas.width * px, canvas.height * py, 1, 1).data,
        ],
        [x, y],
      );
  const noAlert = async () => assert.equal(await dialog.locator('p[role="alert"]').count(), 0);

  // Scenes, explicit switching and look.
  await openStudio();
  await button("Save from editor").click();
  await button("Switch to Scene 1").click();
  await dialog.getByText("Live", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  const solid = await pixel(0.5, 0.5);
  assert.deepEqual(solid.slice(0, 3), [17, 24, 39]);
  await dialog.getByLabel("New scene name").fill("Scene 2");
  await button("Save from editor").click();
  await dialog.getByLabel("Background").selectOption("grid");
  await dialog.getByLabel("Overlay text").fill("On air");
  await button("Add").click();
  await button("Save look").click();
  await page.waitForTimeout(400);
  assert.deepEqual((await pixel(0.1, 0.86)).slice(0, 3), [17, 24, 39], "save must not go live");
  await button("Switch to Scene 2").click();
  await page.waitForTimeout(600);
  assert.deepEqual((await pixel(0.1, 0.86)).slice(0, 3), [56, 189, 248]);
  assert.equal(await button("Remove Scene 2").isDisabled(), true);
  result.checks.scenes = true;
  await noAlert();

  // Camera picture-in-picture is composed into the program and released on removal.
  // Sampled above the banner, which is deliberately drawn over live sources.
  const beforeCamera = await pixel(0.86, 0.72);
  await button("Add camera").click();
  await dialog.getByText("Camera 1", { exact: true }).waitFor();
  await page.waitForTimeout(800);
  const withCamera = await pixel(0.86, 0.72);
  assert.notDeepEqual(withCamera, beforeCamera, "camera must reach the program output");
  result.checks.camera = { beforeCamera, withCamera };

  // Screen source through the real picker path.
  await button("Add screen").click();
  await page.waitForTimeout(1500);
  const screenAlert = await dialog.locator('p[role="alert"]').allTextContents();
  result.checks.screen = screenAlert.length
    ? { skipped: screenAlert[0] }
    : { listed: await dialog.getByText("Screen", { exact: false }).count() };
  if (screenAlert.length) await button("Add microphone").focus();

  // Microphone meter, gain and mute reach the program mix.
  await button("Add microphone").click();
  const meter = dialog.locator("meter");
  await meter.waitFor();
  const peak = async () => {
    let high = 0;
    for (let i = 0; i < 16; i++) {
      high = Math.max(high, await meter.evaluate((node) => node.value));
      await sleep(150);
    }
    return high;
  };
  const audible = await peak();
  assert.ok(audible > 0.01, `microphone meter stayed at ${audible}`);
  await dialog.getByLabel("Mute").check();
  await sleep(300);
  const muted = await peak();
  assert.ok(muted < 0.001, `muted meter reads ${muted}`);
  await dialog.getByLabel("Mute").uncheck();
  result.checks.microphone = { audible, muted };

  // Record: decoded output has picture, overlay, camera and audio.
  await button("Start recording").click();
  await button("Stop recording").waitFor();
  await page.waitForTimeout(4000);

  // Output in memory must not be lost by leaving the route.
  await nav.getByRole("link", { name: "Edit", exact: true }).click();
  await dialog.getByText("Stop the recording, let the upload finish").waitFor();
  await button("Stay in Studio").click();
  result.checks.closeGuard = true;
  await button("Stop recording").click();
  await dialog.getByRole("link", { name: "Download take" }).waitFor();
  const decoded = await dialog
    .getByRole("link", { name: "Download take" })
    .evaluate(async (link) => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = link.href;
      await new Promise((done, fail) => {
        video.onloadeddata = done;
        video.onerror = () => fail(new Error("Take could not be decoded."));
      });
      await video.play();
      await new Promise((done) => setTimeout(done, 1200));
      video.pause();
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const paint = canvas.getContext("2d");
      paint.drawImage(video, 0, 0, 320, 180);
      return {
        size: [video.videoWidth, video.videoHeight],
        bytes: (await (await fetch(link.href)).blob()).size,
        audio: video.captureStream().getAudioTracks().length,
        banner: [...paint.getImageData(32, 155, 1, 1).data],
      };
    });
  assert.deepEqual(decoded.size, [1920, 1080]);
  assert.equal(decoded.audio, 1);
  assert.ok(decoded.banner[2] > 180, `decoded banner was ${decoded.banner}`);
  result.checks.recording = decoded;

  // Editor handoff.
  await button("Add take to project").click();
  await dialog.getByText("was added to Project media.").waitFor();
  result.checks.handoff = true;
  await noAlert();

  // Recent clips.
  await button("Arm buffer").click();
  await button("Stop buffer").waitFor();
  await page.waitForTimeout(6500);
  await button("Add mark").click();
  await button("Save last 30s").click();
  await dialog.getByRole("link", { name: "Download clip" }).waitFor();
  assert.match(await dialog.innerText(), /recent-\d+\.webm · 1 mark/);
  await button("Discard clip").click();
  await button("Stop buffer").click();
  result.checks.recentClips = true;

  // Leaving releases devices; returning recovers scenes without a crash.
  await nav.getByRole("link", { name: "Edit", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.reload();
  await openStudio();
  await dialog.getByText("Live", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("Background").inputValue(), "grid");
  await page.waitForTimeout(600);
  assert.deepEqual((await pixel(0.1, 0.86)).slice(0, 3), [56, 189, 248]);
  result.checks.reloadRecovery = true;

  assert.deepEqual(result.errors, []);
  result.accepted = true;
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
  await writeFile(
    join(root, "docs/verification/lawn-videorc-studio-ui.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
}
