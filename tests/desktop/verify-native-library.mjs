import { app, BrowserWindow, dialog, shell, nativeImage } from "electron";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile, writeFile, stat, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const profile = process.env.SIDECUT_NATIVE_LIBRARY_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const require = createRequire(join(root, "apps/desktop/package.json"));
const ffmpeg = require("ffmpeg-static"),
  ffprobe = require("ffprobe-static").path;
const report = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  production: true,
  syntheticInputs: true,
  simulatedConfirmation: true,
  simulatedShellReveal: true,
  checks: {},
  errors: [],
  accepted: false,
};
let stage = "fixture";
const reportPath = join(root, "docs/verification/lawn-videorc-native-library.json");
const run = (binary, args) => {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `${binary}: ${result.stderr || result.error}`);
  return result.stdout;
};
async function until(task, label) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const value = await task();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function verify() {
  try {
    const id = randomUUID(),
      folder = join(profile, "native-recordings", id);
    // Seed before yielding so production scheme registration runs before Electron is ready.
    mkdirSync(folder, { recursive: true });
    const path = join(folder, "recording.mp4");
    run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-itsoffset",
      "0.25",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=2",
      "-f",
      "lavfi",
      "-itsoffset",
      "0.55",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-fps_mode",
      "passthrough",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-y",
      path,
    ]);
    const probe = JSON.parse(
      run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]),
    );
    const tracks = probe.streams
      .filter((s) => ["audio", "video"].includes(s.codec_type))
      .map((s) => ({
        kind: s.codec_type,
        startSeconds: Number(s.start_time),
        durationSeconds: Number(s.duration),
      }));
    assert.equal(tracks.length, 2);
    assert.ok(tracks.every((t) => t.startSeconds > 0 && t.durationSeconds > 1));
    assert.ok(Math.abs(tracks[0].startSeconds - tracks[1].startSeconds) > 0.1);
    const bytes = statSync(path).size;
    assert.ok(bytes > 1000 && bytes < 128 * 1024 * 1024);
    const recording = {
      id,
      projectID: "fixture-source",
      source: "camera",
      createdAt: new Date().toISOString(),
      status: "ready",
      encoder: "libx264",
      elapsedSeconds: Math.max(...tracks.map((t) => t.startSeconds + t.durationSeconds)),
      bytes,
      tracks,
      error: null,
    };
    writeFileSync(join(folder, "metadata.json"), JSON.stringify(recording));
    const secondID = randomUUID(),
      secondFolder = join(profile, "native-recordings", secondID);
    mkdirSync(secondFolder);
    copyFileSync(path, join(secondFolder, "recording.mp4"));
    writeFileSync(
      join(secondFolder, "metadata.json"),
      JSON.stringify({ ...recording, id: secondID, source: "screen" }),
    );
    report.checks.fixture = { bytes, tracks };
    let response = 0,
      revealed;
    dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
    shell.showItemInFolder = (value) => {
      revealed = value;
    };
    stage = "launch";
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await until(() => BrowserWindow.getAllWindows()[0], "app window");
    window.show();
    window.webContents.setBackgroundThrottling(false);
    const evaluate = (script) => window.webContents.executeJavaScript(script, true);
    const ready = () =>
      until(async () => {
        try {
          return await evaluate(
            "Boolean(document.querySelector('.editor-workspace') && window.sidecutDesktop)",
          );
        } catch {
          return false;
        }
      }, "editor ready");
    await ready();
    const snapshot = () =>
      evaluate(
        "JSON.parse(window.sidecutDesktop.projectRequest(JSON.stringify({type:'snapshot'})).snapshot.json)",
      );
    const section = `[...document.querySelectorAll('details')].find(s => s.querySelector('summary')?.textContent.includes('Native recording library'))`;
    const row = `[...(${section}).querySelectorAll('li')].find(li => li.textContent.includes('camera ·'))`;
    async function openLibrary() {
      await until(() => evaluate(`Boolean(${section})`), "library section");
      await evaluate(`${section}.open = true`);
      await until(
        () => evaluate(`Boolean((${section}).querySelector('li button'))`),
        "library row",
      );
    }
    async function click(label) {
      await until(
        () =>
          evaluate(
            `Boolean([...(${row}).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled))`,
          ),
        `${label} enabled`,
      );
      await evaluate(
        `[...(${row}).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`,
      );
    }
    stage = "bridge and poster";
    const listed = await evaluate("window.sidecutDesktop.nativeRecordingList()");
    assert.deepEqual(
      listed.find((item) => item.id === id),
      recording,
    );
    const asset = await evaluate(
      `window.sidecutDesktop.nativeRecordingRead(${JSON.stringify(id)})`,
    );
    assert.equal(asset.bytes.length, bytes);
    assert.equal(asset.type, "video/mp4");
    assert.deepEqual(Buffer.from(asset.bytes), await readFile(path));
    const poster = await evaluate(
      `window.sidecutDesktop.nativeRecordingPoster(${JSON.stringify(id)})`,
    );
    assert.match(poster, /^data:image\/jpeg;base64,/);
    const jpeg = Buffer.from(poster.split(",")[1], "base64");
    assert.equal(jpeg.subarray(0, 2).toString("hex"), "ffd8");
    const size = nativeImage.createFromBuffer(jpeg).getSize();
    assert.ok(size.width > 0 && size.height > 0 && size.width <= 320 && size.height <= 320);
    await openLibrary();
    await evaluate(`(${row}).scrollIntoView({block:'center'})`);
    await until(
      () => evaluate(`Boolean((${section}).querySelector('img[src^="data:image/jpeg;base64,"]'))`),
      "poster displayed",
    );
    report.checks.poster = size;
    await evaluate(`(${section}).querySelector('ul').scrollIntoView({block:'center'})`);
    await evaluate(
      `[...(${section}).querySelectorAll('li')].find(li => li.textContent.includes('screen ·')).scrollIntoView({block:'center'})`,
    );
    await until(
      () =>
        evaluate(
          `(${section}).querySelectorAll('img[src^="data:image/jpeg;base64,"]').length === 2`,
        ),
      "both lazy posters displayed",
    );
    report.checks.posterRows = 2;
    stage = "reveal";
    await click("Reveal");
    await until(() => revealed, "reveal callback");
    const resolved = await realpath(revealed),
      rel = relative(await realpath(profile), resolved);
    assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
    assert.equal(resolved, await realpath(path));
    assert.ok((await stat(resolved)).isFile());
    report.checks.revealScoped = true;
    stage = "add to current project";
    const before = await snapshot();
    await click("Add to project");
    const imported = await until(async () => {
      const current = await snapshot();
      return current.project.media.find((m) => m.nativeRecording?.id === id) && current;
    }, "media import");
    assert.equal(imported.project.id, before.project.id);
    const media = imported.project.media.find((m) => m.nativeRecording?.id === id);
    assert.deepEqual(media.nativeRecording.tracks, tracks);
    const resource = async (projectID, mediaID) =>
      evaluate(`(async () => {
      const row = (await window.sidecutDesktop.storageRequest({type:'read',collection:'resources',key:JSON.stringify(${JSON.stringify([projectID, mediaID])})}))[0];
      if (!row) return null;
      const parsed = JSON.parse(row.value); const pair = parsed[1].find(entry => entry[0] === 'file');
      const state = parsed[1].find(entry => entry[0] === 'state')?.[1];
      const file = pair?.[1]; if (!file || file[0] !== 'file') return null;
      const bytes = await window.sidecutDesktop.storageGetFile(file[1]);
      const blob = new Blob([bytes], {type:file[2]}); const url = URL.createObjectURL(blob);
      try { const video = document.createElement('video'); video.src = url; video.muted = true;
        const result = await new Promise(resolve => { const timer = setTimeout(() => resolve({error:'playback timed out'}), 8000); video.onloadeddata = () => {clearTimeout(timer); resolve({width:video.videoWidth,height:video.videoHeight,duration:video.duration});}; video.onerror = () => {clearTimeout(timer); resolve({error:video.error?.message || 'decode error'});}; video.load(); });
        return {state, bytes:bytes.byteLength, ...result};
      } finally { URL.revokeObjectURL(url); }
    })()`);
    let playable = await resource(imported.project.id, media.id);
    assert.equal(playable?.state, "available", JSON.stringify(playable));
    assert.equal(playable.bytes, bytes);
    assert.ok(playable.width > 0 && playable.duration > 1, JSON.stringify(playable));
    await evaluate("window.sidecutDesktop.projectFlush()");
    const reload = async () => {
      const accept = (event) => event.preventDefault();
      window.webContents.once("will-prevent-unload", accept);
      const loaded = new Promise((done) => window.webContents.once("did-finish-load", done));
      window.webContents.reload();
      await loaded;
      window.webContents.removeListener("will-prevent-unload", accept);
      await ready();
    };
    await reload();
    assert.ok(
      (await snapshot()).project.media.some(
        (m) => m.id === media.id && m.nativeRecording?.id === id,
      ),
    );
    playable = await resource(imported.project.id, media.id);
    assert.equal(playable?.state, "available");
    assert.ok(playable.width > 0);
    report.checks.currentImportReload = {
      mediaID: media.id,
      bytes: playable.bytes,
      playable: true,
    };
    stage = "new project";
    await openLibrary();
    await click("Edit in new project");
    const created = await until(async () => {
      const current = await snapshot();
      const error = await evaluate(`(${section})?.querySelector('[role=alert]')?.textContent`);
      assert.ok(!error, error);
      return current.project.id !== imported.project.id && current;
    }, "new project");
    const newMedia = created.project.media.find((m) => m.nativeRecording?.id === id);
    assert.ok(newMedia);
    const origin = Math.min(...tracks.map((t) => t.startSeconds));
    for (const track of tracks) {
      const collection =
        track.kind === "video" ? created.project.videoTracks : created.project.audioTracks;
      const clip = collection
        .flatMap((t) => t.clips)
        .find((c) => c.content?.media?.mediaID === newMedia.id);
      assert.ok(clip, `missing ${track.kind} clip`);
      assert.ok(Math.abs(clip.start - (track.startSeconds - origin)) < 0.001);
      assert.ok(
        Math.abs(clip.sourceStart - track.startSeconds) < 0.001,
        `sourceStart must use the MP4 clock: ${JSON.stringify({ clip, track })}`,
      );
      const duration = Math.min(track.durationSeconds, newMedia.duration - track.startSeconds);
      assert.ok(Math.abs(clip.duration - duration) < 0.001);
    }
    report.checks.newProjectOffsets = true;
    await evaluate("window.sidecutDesktop.projectFlush()");
    await reload();
    assert.equal((await snapshot()).project.id, created.project.id);
    playable = await resource(created.project.id, newMedia.id);
    assert.equal(playable?.state, "available");
    assert.ok(playable.width > 0);
    report.checks.newProjectReload = true;
    stage = "delete cancellation and confirmation";
    await openLibrary();
    await click("Delete recording");
    await until(
      () => evaluate(`Boolean((${section}).querySelector('[role=alert]'))`),
      "cancel feedback",
    );
    assert.ok((await stat(path)).isFile());
    response = 1;
    await click("Delete recording");
    await until(
      async () =>
        !(await evaluate(`window.sidecutDesktop.nativeRecordingList()`)).some((r) => r.id === id),
      "deleted recording",
    );
    await assert.rejects(stat(folder), { code: "ENOENT" });
    playable = await resource(imported.project.id, media.id);
    assert.equal(playable?.state, "available");
    assert.ok(playable.width > 0);
    playable = await resource(created.project.id, newMedia.id);
    assert.equal(playable?.state, "available");
    assert.ok(playable.width > 0);
    report.checks.deletionPreservesImportedPlayback = true;
    report.accepted = true;
  } catch (error) {
    report.errors.push({ stage, error: error.stack ?? String(error) });
  } finally {
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report) + "\n");
    app.exit(report.errors.length ? 1 : 0);
  }
}
void verify();
