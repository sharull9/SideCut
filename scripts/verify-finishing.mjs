// Requires the desktop build and the web dev server on loopback port 4270.
import { chromium, firefox, _electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  url = process.env.SIDECUT_VERIFY_URL ?? "http://127.0.0.1:4270";
const temporary = await mkdtemp(join(tmpdir(), "sidecut-finishing-")),
  selected = join(temporary, "完成 with spaces.wfp.dir");
const fixture = JSON.parse(
  await readFile(join(root, "tests/fixtures/tandem/filmora-finishing.json"), "utf8"),
);
for (const [name, data] of Object.entries({
  "project_info.json": fixture.info,
  "Medias/main/timeline.wesproj": fixture.document,
  "Medias/main/extra.json": fixture.extra,
})) {
  const path = join(selected, "ProjectFolder", name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}
const findings = { reference: fixture.reference, platform: process.platform, runtimes: [] };
const wait = async (read, predicate) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Finishing runtime condition timed out.");
};
async function readProject(page, runtime) {
  if (runtime !== "electron") {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download project", exact: true }).click();
    return JSON.parse(await readFile(await (await download).path(), "utf8"));
  }
  await page.evaluate(() => {
    window.projectDownload = null;
    window.oldAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.projectDownload = fetch(this.href).then((r) => r.json());
    };
  });
  try {
    await page.getByRole("button", { name: "Download project", exact: true }).click();
    await page.waitForFunction(() => window.projectDownload != null);
    return await page.evaluate(() => window.projectDownload);
  } finally {
    await page.evaluate(() => {
      HTMLAnchorElement.prototype.click = window.oldAnchorClick;
    });
  }
}
async function verifyImport(page, runtime) {
  console.log(`Verifying finishing in ${runtime}`);
  await page.getByRole("button", { name: "Filmora folder", exact: true }).click({ trial: true });
  await page.getByLabel("Filmora project folder", { exact: true }).setInputFiles(selected);
  await page
    .getByTestId("project-name")
    .filter({ hasText: fixture.info.project_file_name })
    .waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: /^Saved (in browser|on this device)$/ })
    .waitFor();
  const file = await readProject(page, runtime),
    project = file.project;
  assert.equal(project.videoTracks[0].transitions.length, 1);
  assert.equal(project.videoTracks[0].transitions[0].type, "push");
  assert.equal(project.videoTracks[0].transitions[0].duration, 0.4);
  assert.equal(project.videoTracks[1].clips[0].content.text.text, "Finishing title");
  assert.equal(project.videoTracks[1].clips[0].content.text.animationIn, "fadeIn");
  assert.deepEqual(
    project.videoTracks[2].clips.map((c) => [c.start, c.duration]),
    [[1, 1.5]],
  );
  assert.equal(project.audioTracks.find((t) => t.name === "Template sounds").clips.length, 1);
  await page.reload();
  await page
    .getByTestId("project-name")
    .filter({ hasText: fixture.info.project_file_name })
    .waitFor();
  assert.deepEqual((await readProject(page, runtime)).project, project);
  await page.screenshot({ path: join(root, `docs/verification/finishing-${runtime}.png`) });
  const result = {
    runtime,
    version: await page.evaluate(() => navigator.userAgent),
    passed: [
      "transition maps once across a cut",
      "title text/styles/animation",
      "nested template window and sound deduplication",
      "SQLite reload retains all project fields",
    ],
  };
  findings.runtimes.push(result);
  return { file, result };
}
try {
  for (const [runtime, engine] of Object.entries({ chromium, firefox })) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
          acceptDownloads: true,
          viewport: { width: 1280, height: 900 },
        }),
        page = await context.newPage();
      await page.goto(url);
      await verifyImport(page, runtime);
      await context.close();
    } finally {
      await browser.close();
    }
  }
  const wrapper = join(temporary, "launch.mjs"),
    profile = join(temporary, "profile");
  await writeFile(
    wrapper,
    `import {app} from "electron";app.setPath("userData",${JSON.stringify(profile)});app.setAppPath(${JSON.stringify(join(root, "apps/desktop"))});await import(${JSON.stringify(pathToFileURL(join(root, "apps/desktop/dist/main.mjs")).href)});`,
  );
  const require = createRequire(join(root, "apps/desktop/package.json")),
    environment = { ...process.env, SIDECUT_RENDERER_URL: url };
  delete environment.ELECTRON_RUN_AS_NODE;
  const desktop = await _electron.launch({
    executablePath: require("electron"),
    args: [wrapper],
    env: environment,
  });
  try {
    const page = await desktop.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    const { file, result } = await verifyImport(page, "electron");
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, body = {}, expected = 200) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${discovery.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, expected, `${operation}: ${JSON.stringify(value)}`);
      return value;
    };
    let status = await call("status");
    assert.equal(status.revision, file.revision);
    assert.equal(status.openIn.port, discovery.port);
    assert.ok(status.warnings.some((w) => w.includes("Missing Fixture Family")));
    const voice = file.project.media.find((m) => m.kind === "audio"),
      bytes = Array.from(await readFile(join(root, "tests/fixtures/audio/speech.wav")));
    const fsRoot = "/@fs/" + root.replaceAll("\\", "/");
    await page.evaluate(
      async ({ id, bytes: audioBytes, fsRoot: moduleRoot }) => {
        const { BrowserProjectSession } = await import("/src/modules/workspace/browser-session.ts");
        window.fixtureSession = new BrowserProjectSession();
        await fixtureSession.start();
        await fixtureSession.relinkMedia(
          id,
          new File([new Uint8Array(audioBytes)], "voice-audio.wav", { type: "audio/wav" }),
        );
        const { audioIdentity } = await import(
            moduleRoot + "/packages/platform-browser/src/audio-analysis.ts"
          ),
          { TRANSCRIPT_VERSION } = await import(
            moduleRoot + "/packages/platform-browser/src/transcription.ts"
          ),
          { derivedCache } = await import(
            moduleRoot + "/packages/platform-browser/src/derived-cache.ts"
          );
        const resource = await fixtureSession.resource(id);
        await derivedCache(TRANSCRIPT_VERSION + ":" + (await audioIdentity(resource.file)), {
          model: "fixture",
          language: "en",
          words: [
            { text: "Hello", start: 0.1, end: 0.4 },
            { text: "world.", start: 1.1, end: 1.4 },
          ],
        });
      },
      { id: voice.id, bytes, fsRoot },
    );
    const media = await wait(
      () => call("media"),
      (m) => m.items.find((i) => i.id === voice.id)?.analysis.transcript.state === "ready",
    );
    assert.equal(media.items.find((i) => i.id === voice.id).exists, true);
    const revision = media.revision;
    const concurrent = await Promise.all([
      call("status"),
      call("media"),
      call("timeline", { words: true }),
    ]);
    assert.ok(concurrent.every((value) => value.revision === revision));
    result.passed.push("concurrent read queries share the current revision");
    const words = await call("timeline", { words: true });
    assert.ok(words.text.includes("Hello world."));
    assert.ok(words.text.includes("~ push left 0.400s"));
    const filtered = await call("timeline", { format: "json", from: 2, to: 3 });
    assert.equal(filtered.project.videoTracks[0].transitions.length, 0);
    assert.ok((await call("timeline", { summary: true })).text.includes("Tracks, top to bottom"));
    assert.equal((await call("status")).revision, revision);
    result.passed.push(
      "HTTP status owner/fonts and shared revision",
      "media sees copied resource and real cached transcript",
      "timeline words/summary/JSON are read-only",
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("dialog").locator("select").first().selectOption("wav");
    await page.getByRole("button", { name: "Queue export", exact: true }).click();
    status = await wait(
      () => call("status"),
      (s) => s.exports.some((e) => e.state === "done"),
    );
    assert.equal(status.exports[0].preset, "wav");
    await page.keyboard.press("Escape");
    const measured = await call("media");
    assert.equal(measured.items.find((i) => i.id === voice.id).analysis.loudness.state, "ready");
    result.passed.push("status exposes actual UI WAV queue and media loudness cache");
    const target = file.project.videoTracks[1].clips[0].id;
    await call("apply", {
      expectedRevision: revision,
      label: "Runtime agent title",
      commands: [{ updateClip: { clipID: target, patch: { name: "Reviewed title" } } }],
    });
    status = await wait(
      () => call("status"),
      (s) => !s.dirty,
    );
    assert.ok(
      status.reviewPending.some(
        (r) => r.label === "Runtime agent title" && r.clipIDs.includes(target),
      ),
    );
    const editedRevision = status.revision;
    assert.ok((await call("status")).reviewPending.length);
    await page.getByRole("button", { name: "Mark agent edits reviewed", exact: true }).click();
    status = await wait(
      () => call("status"),
      (s) => s.reviewPending.length === 0,
    );
    assert.equal(status.revision, editedRevision);
    await page.reload();
    await page
      .getByTestId("project-name")
      .filter({ hasText: fixture.info.project_file_name })
      .waitFor();
    assert.equal((await call("status")).reviewPending.length, 0);
    result.passed.push(
      "status reads retain pending reviews",
      "UI acknowledgment persists across reload without editing the project",
    );
    await page.screenshot({ path: join(root, "docs/verification/finishing-queries.png") });
    findings.queries = {
      revision: editedRevision,
      voiceID: voice.id,
      transitions: filtered.project.videoTracks[0].transitions.length,
      exports: status.exports,
      jobs: status.jobs,
    };
  } finally {
    await desktop.close();
  }
  await writeFile(
    join(root, "docs/verification/finishing-runtime.json"),
    JSON.stringify(findings, null, 2) + "\n",
  );
  console.log(JSON.stringify(findings));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
