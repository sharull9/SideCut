// Requires the desktop build and vp dev --host 127.0.0.1 --port 4270 --strictPort in apps/web.
import { chromium, firefox, _electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const url = process.env.SIDECUT_VERIFY_URL ?? "http://127.0.0.1:4270";
const temporary = await mkdtemp(join(tmpdir(), "sidecut-filmora-"));
const selected = join(temporary, "项目 with spaces.wfp.dir");
const fixture = JSON.parse(
  await readFile(join(root, "tests/fixtures/tandem/filmora-mappings.json"), "utf8"),
);
const entries = {
  "project_info.json": fixture.info,
  "Medias/main/timeline.wesproj": fixture.document,
  "Medias/main/extra.json": fixture.extra,
};
for (const [name, data] of Object.entries(entries)) {
  const path = join(selected, "ProjectFolder", name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}
const findings = { reference: fixture.reference, platform: process.platform, runtimes: [] };
async function verify(page, runtime) {
  console.log(`Verifying Filmora import in ${runtime}`);
  page.on("pageerror", (error) => console.error(`${runtime}: ${error.message}`));
  await page.getByTestId("project-name").waitFor();
  await page
    .getByRole("button", { name: "Filmora folder", exact: true })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Filmora folder", exact: true }).click({ trial: true });
  await page.waitForFunction(
    () =>
      !document.querySelector('input[aria-label="Filmora project folder"]').disabled &&
      !document.body.textContent.includes("Opening..."),
  );
  await page.getByLabel("Filmora project folder", { exact: true }).setInputFiles(selected);
  await page
    .getByTestId("project-name")
    .filter({ hasText: fixture.info.project_file_name })
    .waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: /^Saved (in browser|on this device)$/ })
    .waitFor();
  const read = async () => {
    if (runtime === "electron") {
      await page.evaluate(() => {
        window.filmoraDownload = null;
        window.originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          window.filmoraDownload = fetch(this.href).then((response) => response.json());
        };
      });
      try {
        await page.getByRole("button", { name: "Download project", exact: true }).click();
        await page.waitForFunction(() => window.filmoraDownload != null);
        return await page.evaluate(() => window.filmoraDownload);
      } finally {
        await page.evaluate(() => {
          HTMLAnchorElement.prototype.click = window.originalAnchorClick;
        });
      }
    }
    const pending = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("button", { name: "Download project", exact: true }).click();
    let download;
    try {
      download = await pending;
    } catch (cause) {
      console.error(await page.locator(".editor-notice").allTextContents());
      await page.screenshot({ path: join(root, "docs/verification/filmora-failure.png") });
      throw cause;
    }
    return JSON.parse(await readFile(await download.path(), "utf8"));
  };
  const project = (await read()).project;
  assert.equal(project.videoTracks.length, 2);
  assert.deepEqual(
    project.videoTracks.map((t) => t.name),
    ["Camera", "Camera extra"],
  );
  assert.equal(project.markers[0].time, 1.25);
  assert.equal(project.markers[0].note, "Synthetic marker note");
  const picture = project.videoTracks[0].clips[0],
    sound = project.audioTracks[0].clips[0];
  assert.equal(picture.linkGroup, sound.linkGroup);
  assert.equal(picture.video.transform.scale, 0.5);
  assert.equal(picture.video.opacity, 0.7);
  assert.equal(picture.video.cutout.enabled, true);
  assert.equal(picture.video.crop.left, 0.1);
  assert.deepEqual(
    picture.keyframes["video.transform.scale"].map((k) => [k.time, k.value]),
    [
      [0, 0.5],
      [2, 1],
    ],
  );
  assert.deepEqual(
    project.media[0].look.map((e) => e.type),
    ["colorAdjust", "hsl"],
  );
  assert.deepEqual(
    picture.video.effects.map((e) => e.type),
    ["dropShadow", "border"],
  );
  assert.equal(sound.audio.gainDB, 0);
  assert.equal(sound.audio.normalizeTo, -20);
  assert.equal(sound.audio.fadeIn, 0.25);
  assert.equal(sound.audio.fadeOut, 0.4);
  await page.reload();
  await page
    .getByTestId("project-name")
    .filter({ hasText: fixture.info.project_file_name })
    .waitFor();
  assert.deepEqual((await read()).project, project);
  const badPath = join(selected, "ProjectFolder/Medias/main/extra.json");
  await writeFile(badPath, "malformed");
  try {
    await page.getByLabel("Filmora project folder", { exact: true }).setInputFiles(selected);
    await page.getByText("Action needs attention", { exact: true }).waitFor();
    assert.deepEqual((await read()).project, project);
  } finally {
    await writeFile(badPath, JSON.stringify(fixture.extra));
  }
  const layout = await page.evaluate(() => {
    const actions = [...document.querySelectorAll(".editor-topbar-actions button")].map((b) => ({
      label: b.textContent.trim(),
      right: b.getBoundingClientRect().right,
    }));
    return { width: innerWidth, actions, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.ok(
    layout.actions.every((action) => action.right <= layout.width),
    JSON.stringify(layout),
  );
  assert.ok(layout.scrollWidth <= layout.width);
  await page.screenshot({ path: join(root, `docs/verification/filmora-${runtime}.png`) });
  findings.runtimes.push({
    runtime,
    version: await page.evaluate(() => navigator.userAgent),
    passed: [
      "folder selection through editor control",
      "markers, names, linked audio/video and overlap lanes",
      "transform, crop, opacity, cutout and speed-adjusted keys",
      "shared colour looks, shadow and border",
      "speech levels and fades",
      "SQLite saved reload preserves every project field",
      "malformed folder preserves current project",
      "all toolbar buttons fit at 1280 pixels",
    ],
    layout,
  });
}
try {
  for (const [runtime, engine] of Object.entries({ chromium, firefox })) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await page.goto(url);
      await verify(page, runtime);
      await context.close();
    } finally {
      await browser.close();
    }
  }
  const wrapper = join(temporary, "launch.mjs");
  await writeFile(
    wrapper,
    `import { app } from "electron"; app.setPath("userData", ${JSON.stringify(join(temporary, "profile"))}); app.setAppPath(${JSON.stringify(join(root, "apps/desktop"))}); await import(${JSON.stringify(pathToFileURL(join(root, "apps/desktop/dist/main.mjs")).href)});`,
  );
  const require = createRequire(join(root, "apps/desktop/package.json"));
  const environment = { ...process.env, SIDECUT_RENDERER_URL: url };
  delete environment.ELECTRON_RUN_AS_NODE;
  const desktop = await _electron.launch({
    executablePath: require("electron"),
    args: [wrapper],
    env: environment,
  });
  try {
    const page = await desktop.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await verify(page, "electron");
  } finally {
    await desktop.close();
  }
  await writeFile(
    join(root, "docs/verification/filmora-mappings-runtime.json"),
    JSON.stringify(findings, null, 2) + "\n",
  );
  console.log(JSON.stringify(findings));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
