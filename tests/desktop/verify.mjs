// Run from the repository root after build:desktop:
// vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify.mjs
import { app, BrowserWindow, dialog } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const profile = mkdtempSync(join(tmpdir(), "sidecut-electron-verify-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
const findings = {};
const wait = async (predicate) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resume) => setTimeout(resume, 50));
  }
  throw new Error("Desktop verification timed out.");
};
const evaluate = (window, source) => window.webContents.executeJavaScript(source);
const request = async (window, value) => {
  if (value.type !== "snapshot") {
    const current = await request(window, { type: "snapshot" });
    value = {
      ...value,
      projectID: JSON.parse(current.snapshot.json).project.id,
      generation: current.snapshot.generation,
    };
  }
  return evaluate(
    window,
    `window.sidecutDesktop.projectRequest(${JSON.stringify(JSON.stringify(value))})`,
  );
};

async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const first = await wait(() => BrowserWindow.getAllWindows()[0]);
    await wait(() =>
      evaluate(
        first,
        `Boolean(window.sidecutDesktop && document.querySelector('[data-testid="project-name"]'))`,
      ).catch(() => false),
    );
    findings.isolation = await evaluate(
      first,
      `({ node: typeof process, require: typeof require, bridge: Object.keys(window.sidecutDesktop).sort() })`,
    );
    assert.equal(findings.isolation.node, "undefined");
    assert.equal(findings.isolation.require, "undefined");
    const second = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(root, "apps/desktop/dist/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await second.loadURL("sidecut://app/");
    await wait(() =>
      evaluate(
        second,
        `Boolean(window.sidecutDesktop && document.querySelector('[data-testid="project-name"]'))`,
      ).catch(() => false),
    );
    const initial = await request(first, { type: "snapshot" });
    const revision = JSON.parse(initial.snapshot.json).revision;
    await request(first, {
      type: "apply",
      batch: {
        label: "Desktop runtime rename",
        expectedRevision: revision,
        commands: [{ updateProject: { patch: { name: "Desktop runtime fixture" } } }],
      },
    });
    await wait(() =>
      evaluate(
        second,
        `document.querySelector('[data-testid="project-name"]')?.textContent === 'Desktop runtime fixture'`,
      ),
    );
    findings.sharedWindow = JSON.parse(
      (await request(second, { type: "snapshot" })).snapshot.json,
    ).revision;
    assert.equal(findings.sharedWindow, revision + 1);
    findings.staleRejected = await evaluate(
      second,
      `(() => { try { window.sidecutDesktop.projectRequest(${JSON.stringify(JSON.stringify({ type: "undo", revision }))}); return false; } catch { return true; } })()`,
    );
    assert.equal(findings.staleRejected, true);
    await request(second, { type: "undo", revision: revision + 1 });
    await request(first, { type: "redo", revision: revision + 2 });
    await evaluate(first, `window.sidecutDesktop.projectFlush()`);
    const saved = JSON.parse(await readFile(join(profile, "current.tandem"), "utf8"));
    assert.equal(saved.project.name, "Desktop runtime fixture");
    findings.diskRevision = saved.revision;
    second.destroy();
    const reopened = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(root, "apps/desktop/dist/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await reopened.loadURL("sidecut://app/");
    assert.equal(
      JSON.parse((await request(reopened, { type: "snapshot" })).snapshot.json).revision,
      saved.revision,
    );
    findings.reopen = true;
    const bytes = await readFile(join(root, "tests/fixtures/audio/speech.wav"));
    const mediaRoot = join(profile, "media");
    await mkdir(join(mediaRoot, "music"), { recursive: true });
    await mkdir(join(mediaRoot, "exports"));
    await writeFile(join(mediaRoot, "music/fixture.wav"), bytes);
    await writeFile(join(mediaRoot, "exports/ignored.wav"), bytes);
    const originalDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [mediaRoot] });
    try {
      await evaluate(first, `window.sidecutDesktop.folderSelect()`);
    } finally {
      dialog.showOpenDialog = originalDialog;
    }
    const catalogue = await wait(async () => {
      const value = JSON.parse((await request(first, { type: "snapshot" })).snapshot.json);
      return value.project.media.length === 1 ? value : null;
    });
    const sourceID = catalogue.project.media[0].id;
    assert.equal(catalogue.project.media[0].role, "music");
    await writeFile(join(mediaRoot, "music/fixture.wav"), Buffer.concat([bytes, Buffer.from([0])]));
    const refreshed = await wait(async () => {
      const value = JSON.parse((await request(first, { type: "snapshot" })).snapshot.json);
      return value.revision > catalogue.revision ? value : null;
    });
    assert.equal(refreshed.project.media.length, 1);
    assert.equal(refreshed.project.media[0].id, sourceID);
    findings.folder = {
      count: refreshed.project.media.length,
      stableID: true,
      path: refreshed.project.media[0].path,
      role: refreshed.project.media[0].role,
      cacheExcluded: true,
    };
    await request(first, {
      type: "apply",
      batch: {
        label: "Place native fixture",
        expectedRevision: refreshed.revision,
        commands: [
          { updateSettings: { patch: { width: 320, height: 180 } } },
          {
            insertClip: {
              trackID: refreshed.project.audioTracks[0].id,
              clip: {
                id: "clip_native_fixture",
                content: { media: { mediaID: sourceID } },
                start: 0,
                duration: 0.2,
                sourceStart: 0.1,
              },
            },
          },
        ],
      },
    });
    await wait(() =>
      evaluate(first, `!document.querySelector('button[disabled][aria-label="Import media"]')`),
    );
    await evaluate(
      first,
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export').click()`,
    );
    await wait(() =>
      evaluate(
        first,
        `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Render WebM' && !b.disabled)`,
      ),
    );
    await evaluate(
      first,
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Render WebM').click()`,
    );
    await wait(() => evaluate(first, `Boolean(document.querySelector('a[download$=".webm"]'))`));
    findings.timelineExport = await evaluate(
      first,
      `(async () => {
      const blob = await (await fetch(document.querySelector('a[download$=".webm"]').href)).arrayBuffer();
      const probe = JSON.parse(new TextDecoder().decode(await window.sidecutDesktop.nativeMedia('timeline-probe', 'probe', new Uint8Array(blob))));
      return { bytes: blob.byteLength, codecs: probe.streams.map(s => s.codec_name), duration: Number(probe.format.duration) };
    })()`,
    );
    assert.ok(findings.timelineExport.codecs.includes("vp8"));
    assert.ok(findings.timelineExport.codecs.includes("opus"));
    findings.nativeExport = await evaluate(
      first,
      `(async () => {
    const bridge = window.sidecutDesktop;
    const source = new Uint8Array(${JSON.stringify([...bytes])});
    const result = await bridge.nativeMedia('runtime-export', 'export', source, .1, .2);
    const probe = JSON.parse(new TextDecoder().decode(await bridge.nativeMedia('runtime-probe', 'probe', result)));
    return { bytes: result.length, codec: probe.streams[0].codec_name, duration: Number(probe.format.duration) };
  })()`,
    );
    assert.equal(findings.nativeExport.codec, "opus");
    assert.ok(findings.nativeExport.bytes > 0);
    findings.savedLabel = await evaluate(
      first,
      `document.querySelector('[role="status"]')?.textContent`,
    );
    findings.systemMediaOnPath = ["ffmpeg", "ffprobe"].some(
      (command) => spawnSync(command, ["-version"], { windowsHide: true }).status === 0,
    );
    findings.platform = process.platform;
    findings.electron = process.versions.electron;
    await writeFile(
      join(root, "docs/verification/phases-111-115-runtime.json"),
      JSON.stringify(findings, null, 2) + "\n",
    );
    console.log(JSON.stringify(findings));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    // Normal quit flushes the host queue and releases the project lock.
    app.once("will-quit", () => {
      void rm(profile, { recursive: true, force: true });
    });
    app.quit();
  }
}
void verify();
