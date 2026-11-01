import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeSync, statSync, writeFileSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const profile = process.env.SIDECUT_DELIVERY_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const require = createRequire(join(root, "apps/desktop/package.json"));
const ffmpeg = require("ffmpeg-static"),
  ffprobe = require("ffprobe-static").path;
const reportPath = join(root, "docs/verification/lawn-videorc-delivery.json");
const report = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  production: true,
  syntheticInputs: true,
  physicalCapture: false,
  accepted: false,
  checks: Object.fromEntries(
    [
      "largeMovingFixture",
      "import",
      "reloadAndSeek",
      "deleteRetainsResource",
      "nativeEncode",
      "frozenQueueSnapshot",
      "restartRendering",
      "restartNativeEncoding",
      "restartPublication",
      "complexLongFormOutput",
    ].map((name) => [name, { status: "notrun" }]),
  ),
  errors: [],
  limits: [
    "The desktop artifact must be rebuilt after implementation changes; this runner does not build it.",
    "The size fixture uses an MP4 free box as padding; it exercises file size and seeking, not high-bitrate sustained throughput.",
    "Synthetic accelerated media does not establish physical capture or a measured 60-minute session.",
  ],
};
let stage = "largeMovingFixture";
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  assert.equal(result.status, 0, `${binary}: ${result.stderr || result.error}`);
  return result.stdout;
}
async function until(task, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
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
    mkdirSync(folder, { recursive: true });
    const path = join(folder, "recording.mp4");
    // Generate before yielding so the production app registers its privileged scheme before ready.
    run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=2:duration=610",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=8000:duration=610",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-y",
        path,
      ],
      { encoding: "utf8" },
    );
    const padSize = 257 * 1024 * 1024;
    const fd = openSync(path, "a");
    try {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(padSize, 0);
      header.write("free", 4);
      writeSync(fd, header);
      const chunk = Buffer.alloc(1024 * 1024);
      for (let remaining = padSize - 8; remaining > 0; remaining -= chunk.length)
        writeSync(fd, chunk, 0, Math.min(remaining, chunk.length));
    } finally {
      closeSync(fd);
    }
    const probe = JSON.parse(
      run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], {
        encoding: "utf8",
      }),
    );
    const tracks = probe.streams
      .filter((s) => ["audio", "video"].includes(s.codec_type))
      .map((s) => ({
        kind: s.codec_type,
        startSeconds: Number(s.start_time),
        durationSeconds: Number(s.duration),
      }));
    const bytes = statSync(path).size;
    assert.ok(bytes > 256 * 1024 * 1024);
    assert.ok(Number(probe.format.duration) >= 600);
    assert.deepEqual(tracks.map((t) => t.kind).sort(), ["audio", "video"]);
    const frameHashes = [1, 305, 608].map((time) =>
      createHash("sha256")
        .update(
          run(ffmpeg, [
            "-v",
            "error",
            "-ss",
            String(time),
            "-i",
            path,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ]),
        )
        .digest("hex"),
    );
    assert.equal(new Set(frameHashes).size, 3, "fixture must have distinct moving frames");
    const recording = {
      id,
      projectID: "delivery-fixture",
      source: "camera",
      createdAt: new Date().toISOString(),
      status: "ready",
      encoder: "libx264",
      elapsedSeconds: Number(probe.format.duration),
      bytes,
      tracks,
      error: null,
    };
    writeFileSync(join(folder, "metadata.json"), JSON.stringify(recording));
    report.checks.largeMovingFixture = {
      status: "pass",
      bytes,
      durationSeconds: Number(probe.format.duration),
      tracks,
      frameHashes,
      paddingBytes: padSize,
    };
    stage = "import";
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await until(() => BrowserWindow.getAllWindows()[0], "app window");
    window.show();
    window.webContents.setBackgroundThrottling(false);
    const evaluate = (script) => window.webContents.executeJavaScript(script, true);
    await until(async () => {
      try {
        return await evaluate(
          "Boolean(document.querySelector('.editor-workspace') && window.sidecutDesktop)",
        );
      } catch {
        return false;
      }
    }, "editor ready");
    const section = `[...document.querySelectorAll('details')].find(s => s.querySelector('summary')?.textContent.includes('Native recording library'))`;
    await until(() => evaluate(`Boolean(${section})`), "library section");
    await evaluate(`${section}.open = true`);
    const row = `[...(${section}).querySelectorAll('li')].find(li => li.textContent.includes('camera ·'))`;
    await until(() => evaluate(`Boolean(${row})`), "recording row");
    const button = await evaluate(
      `(() => { const b = [...(${row}).querySelectorAll('button')].find(x => x.textContent.trim() === 'Add to project'); return { exists: !!b, disabled: b?.disabled, text: (${row}).textContent }; })()`,
    );
    assert.ok(
      button.exists && !button.disabled,
      `Large recording import unavailable: ${JSON.stringify(button)}`,
    );
    await evaluate(
      `[...(${row}).querySelectorAll('button')].find(x => x.textContent.trim() === 'Add to project').click()`,
    );
    const imported = await until(
      async () => {
        const result = await evaluate(
          "JSON.parse(window.sidecutDesktop.projectRequest(JSON.stringify({type:'snapshot'})).snapshot.json)",
        );
        return result.project.media.find((m) => m.nativeRecording?.id === id) && result;
      },
      "large recording import",
      120000,
    );
    const mediaID = imported.project.media.find((m) => m.nativeRecording?.id === id).id;
    const resource = async () =>
      evaluate(`(async () => {
      const row = (await window.sidecutDesktop.storageRequest({type:'read',collection:'resources',key:JSON.stringify(${JSON.stringify([imported.project.id, mediaID])})}))[0];
      if (!row) return null;
      const entries = JSON.parse(row.value)[1];
      return { file: entries.find(e => e[0] === 'file')?.[1], state: entries.find(e => e[0] === 'state')?.[1] };
    })()`);
    const saved = await resource();
    assert.equal(saved?.state, "available");
    assert.equal(saved.file?.[0], "file");
    const fileID = saved.file[1];
    assert.equal(
      await evaluate(`window.sidecutDesktop.storageFileSize(${JSON.stringify(fileID)})`),
      bytes,
    );
    report.checks.import = {
      status: "pass",
      projectID: imported.project.id,
      mediaID,
      fileID,
      bytes,
    };
    await evaluate("window.sidecutDesktop.projectFlush()");
    stage = "reloadAndSeek";
    const acceptUnload = (event) => event.preventDefault();
    window.webContents.once("will-prevent-unload", acceptUnload);
    const loaded = new Promise((done) => window.webContents.once("did-finish-load", done));
    window.webContents.reload();
    await loaded;
    window.webContents.removeListener("will-prevent-unload", acceptUnload);
    await until(async () => {
      try {
        return await evaluate(
          "Boolean(document.querySelector('.editor-workspace') && window.sidecutDesktop)",
        );
      } catch {
        return false;
      }
    }, "editor reload");
    assert.equal((await resource())?.file?.[1], fileID);
    const seek = async () =>
      evaluate(`(async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('sidecut-files');
      const file = await (await directory.getFileHandle(${JSON.stringify(fileID)})).getFile();
      const url = URL.createObjectURL(file), video = document.createElement('video'); video.muted = true; video.src = url;
      try {
        const wait = (event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timed out waiting for ' + event)), 15000); video.addEventListener(event, () => { clearTimeout(timer); resolve(); }, {once:true}); video.addEventListener('error', () => {clearTimeout(timer); reject(new Error('Video decode failed'));}, {once:true}); });
        await wait('loadedmetadata');
        const times = []; for (const t of [1, 305, 608]) { video.currentTime = t; await wait('seeked'); times.push(video.currentTime); }
        return {size:file.size, duration:video.duration, width:video.videoWidth, times};
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
    })()`);
    const playback = await seek();
    assert.equal(playback.size, bytes);
    assert.ok(playback.width > 0 && playback.duration >= 600);
    assert.ok(playback.times.every((time, index) => Math.abs(time - [1, 305, 608][index]) < 1));
    report.checks.reloadAndSeek = { status: "pass", ...playback };
    stage = "deleteRetainsResource";
    await evaluate(`window.sidecutDesktop.nativeRecordingDelete(${JSON.stringify(id)})`);
    await assert.rejects(stat(folder), { code: "ENOENT" });
    assert.equal((await resource())?.file?.[1], fileID);
    const retained = await seek();
    assert.equal(retained.size, bytes);
    assert.ok(retained.width > 0);
    report.checks.deleteRetainsResource = { status: "pass", fileID, seekTimes: retained.times };
    stage = "nativeEncode";
    // Encode a short extract through the production bridge; the padded source is not a throughput benchmark.
    const shortPath = join(profile, "delivery-short.mp4");
    run(
      ffmpeg,
      [
        "-v",
        "error",
        "-ss",
        "1",
        "-i",
        join(profile, "storage-files", fileID),
        "-t",
        "2",
        "-c",
        "copy",
        "-y",
        shortPath,
      ],
      { encoding: "utf8" },
    );
    const shortBytes = await import("node:fs/promises").then((fs) => fs.readFile(shortPath));
    const inputID = await evaluate(
      `window.sidecutDesktop.storagePutFile(new Uint8Array(${JSON.stringify([...shortBytes])}))`,
    );
    const output = await evaluate(
      `window.sidecutDesktop.deliveryEncode(${JSON.stringify(randomUUID())}, ${JSON.stringify(inputID)}, {codec:'h264',videoBitrate:500000,audioBitrate:64000,name:'delivery-check.mp4'})`,
    );
    const encoded = JSON.parse(
      run(
        ffprobe,
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          join(profile, "storage-files", output.id),
        ],
        { encoding: "utf8" },
      ),
    );
    assert.ok(encoded.streams.some((s) => s.codec_type === "video" && s.codec_name === "h264"));
    assert.ok(encoded.streams.some((s) => s.codec_type === "audio" && s.codec_name === "aac"));
    assert.ok(Number(encoded.format.duration) > 0);
    report.checks.nativeEncode = {
      status: "pass",
      outputID: output.id,
      bytes: output.bytes,
      durationSeconds: Number(encoded.format.duration),
    };
  } catch (error) {
    report.checks[stage] = { status: "fail" };
    report.errors.push({ stage, error: error.stack ?? String(error) });
  } finally {
    report.accepted = Object.values(report.checks).every((check) => check.status === "pass");
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report) + "\n");
    app.exit(report.accepted ? 0 : 1);
  }
}
void verify();
