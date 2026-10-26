// Requires build:desktop and the web dev server at 127.0.0.1:4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-analysis-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
const evidence = { platform: process.platform };
let resultCode = 0;
const wait = async (predicate) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Runtime timed out");
};
function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) =>
    bytes.writeInt16LE(Math.round(sample * 16000), 44 + index * 2),
  );
  return bytes.toString("base64");
}
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    let window;
    await wait(() => {
      window = BrowserWindow.getAllWindows()[0];
      return !!window;
    });
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    const fsRoot = `/@fs/${root.replaceAll("\\", "/")}`;
    let seed = 42;
    const sound = Float32Array.from({ length: 48000 }, () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 2 ** 32 - 0.5;
    });
    const mic = new Float32Array(50000);
    mic.set(
      sound.map((v) => -v * 0.3),
      2000,
    );
    const fixture = {
      revision: 0,
      project: {
        id: "jobs-runtime",
        name: "Comments, sync, jobs and archive",
        media: [
          {
            id: "camera",
            path: "camera.wav",
            kind: "video",
            role: "camera",
            hasAudio: true,
            hasVideo: true,
            duration: 6,
            look: [{ type: "lut", params: { path: "identity.cube" } }],
          },
          {
            id: "mic",
            path: "mic.wav",
            kind: "audio",
            role: "music",
            hasAudio: true,
            duration: 6.25,
          },
        ],
        videoTracks: [
          {
            id: "v",
            kind: "video",
            name: "Camera",
            clips: [
              {
                id: "cam",
                linkGroup: "take",
                duration: 6,
                content: { media: { mediaID: "camera" } },
              },
            ],
          },
        ],
        audioTracks: [
          {
            id: "a",
            kind: "audio",
            name: "Voice",
            rippleMode: "cut",
            clips: [
              {
                id: "voice",
                linkGroup: "take",
                duration: 6,
                content: { media: { mediaID: "camera" } },
              },
            ],
          },
        ],
        markers: [{ id: "comment", kind: "comment", name: "Review this phrase", time: 3 }],
      },
    };
    await evaluate(`(async()=>{
      const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();
      await fixtureSession.openProject(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.tandem'));
      const decode=(data,name)=>new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],name,{type:'audio/wav'});
      await fixtureSession.stageServiceResource('jobs-runtime','camera',decode(${JSON.stringify(wav(sound))},'camera.wav'),new AbortController().signal);
      await fixtureSession.stageServiceResource('jobs-runtime','mic',decode(${JSON.stringify(wav(mic))},'mic.wav'),new AbortController().signal);
      await fixtureSession.stageServiceResource('jobs-runtime','lut:identity.cube',new File([['LUT_3D_SIZE 2','0 0 0','1 0 0','0 1 0','1 1 0','0 0 1','1 0 1','0 1 1','1 1 1'].join(String.fromCharCode(10))],'identity.cube'),new AbortController().signal);
      const {audioIdentity}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/audio-analysis.ts")});
      const {TRANSCRIPT_VERSION}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/transcription.ts")});
      const {derivedCache}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/derived-cache.ts")});
      window.cacheKey=TRANSCRIPT_VERSION+':'+await audioIdentity((await fixtureSession.resource('camera')).file);
      await derivedCache(cacheKey,{model:'fixture',language:'en',words:[{text:'Before',start:1,end:2},{text:'After',start:3,end:4}]});
    })()`);
    const run = (args) =>
      new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            join(root, "scripts/sidecut-cli.mjs"),
            ...args,
            "--endpoint-file",
            join(profile, "current.tandem.api.json"),
          ],
          {
            cwd: profile,
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: "1",
              SIDECUT_PROJECT: "",
              TANDEM_PROJECT: "",
              SIDECUT_AUTHOR: "runtime-cli",
            },
            windowsHide: true,
          },
        );
        let out = "",
          err = "";
        child.stdout.on("data", (v) => (out += v));
        child.stderr.on("data", (v) => (err += v));
        child.on("error", reject);
        child.on("close", (code) => done({ code, out, err }));
      });
    const success = async (args) => {
        const result = await run(args);
        assert.equal(result.code, 0, result.err);
        return result.out;
      },
      json = async (...args) => JSON.parse(await success([...args, "--json"])),
      project = () => evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      revision = async () => Number(await success(["status", "--revision"]));
    const original = await project(),
      start = await revision();
    const comments = await json("comments");
    assert.equal(comments.comments[0].said, "Before | After");
    assert.match(await success(["comments"]), /said: Before \| After/);
    const resolved = await json("comments", "resolve", "comment", "--label", "CLI resolved");
    assert.equal(resolved.author, "runtime-cli");
    await wait(async () => JSON.parse(await project()).markers.length === 0);
    await json("undo");
    assert.equal(await project(), original);
    const picture = await json(
      "sync",
      "80ms",
      "--media",
      "camera",
      "--default",
      "--label",
      "CLI delay",
    );
    assert.equal(picture.files[0].pictureDelay, 0.08);
    assert.equal(picture.defaultDelay, 0.08);
    assert.equal(picture.applied.author, "runtime-cli");
    assert.match(await success(["sync"]), /80 ms/);
    await json("undo");
    assert.equal(await project(), original);
    const beforeSound = await revision(),
      soundPreview = await json(
        "sync",
        "mic.wav",
        "--to",
        "camera.wav",
        "--no-place",
        "--dry-run",
        "--expect",
        String(beforeSound),
      );
    assert.ok(Math.abs(soundPreview.matches[0].offset - 0.25) < 0.001);
    assert.equal(await project(), original);
    const synced = await json(
      "sync",
      "mic.wav",
      "--to",
      "camera.wav",
      "--no-place",
      "--label",
      "CLI sound",
      "--expect",
      String(beforeSound),
    );
    assert.equal(synced.applied.author, "runtime-cli");
    assert.equal(synced.applied.revision, beforeSound + 1);
    await json("undo");
    assert.equal(await project(), original);
    const waited = await json("wait", "transcript", "--media", "camera", "--timeout", "2");
    assert.equal(waited.ok, true);
    assert.equal(waited.finished[0].words, 2);
    assert.match(await success(["wait", "export", "--timeout", "0"]), /No exports running/);
    const transcribed = await json("transcribe", "cam", "--wait", "--timeout", "2");
    assert.equal(transcribed.ok, true);
    assert.equal(transcribed.files[0].words, 2);
    assert.match(await success(["transcribe", "camera", "--no-wait"]), /reads it/);
    const baseline = await revision();
    await json(
      "apply",
      JSON.stringify({ commands: [{ updateClip: { clipID: "cam", patch: { start: 0.2 } } }] }),
    );
    const moved = await project(),
      diff = await json("diff", String(baseline));
    assert.ok(diff.changes.some((c) => c.id === "cam" && Math.abs(c.shift - 0.2) < 1e-6));
    assert.match(await success(["diff", "--since", String(baseline)]), /1 moved/);
    const restorePreview = await json("restore", "--from", String(baseline), "--clips", "cam");
    assert.ok(restorePreview.items.some((i) => i.action === "changeBack"));
    assert.equal(await project(), moved);
    const restored = await json(
      "restore",
      "--from",
      String(baseline),
      "--clips",
      "cam",
      "--apply",
      "--label",
      "CLI restore",
    );
    assert.equal(restored.applied.author, "runtime-cli");
    await wait(async () => JSON.parse(await project()).videoTracks[0].clips[0].start === 0);
    await json("undo");
    assert.equal(await project(), moved);
    const clips = await json("clips", "--track", "Camera");
    assert.deepEqual(
      clips.clips.map((c) => c.id),
      ["cam"],
    );
    assert.equal(await success(["clips", "--media", "camera", "--ids"]), "cam\nvoice\n");
    const beforeFailures = await project(),
      failures = [];
    for (const args of [
      ["comments", "resolve", "unknown"],
      ["sync", "2"],
      ["wait", "unknown"],
      ["transcribe", "missing", "--wait"],
      ["diff", "999999"],
      ["restore", "--from", "999999", "--clips", "cam", "--apply"],
      ["clips", "--track", "missing"],
    ]) {
      const result = await run(args);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      failures.push({ args, code: result.code });
      assert.equal(await project(), beforeFailures);
    }
    await json(
      "apply",
      JSON.stringify({
        commands: [
          {
            addMedia: {
              item: {
                id: "offline",
                path: "offline.wav",
                kind: "audio",
                hasAudio: true,
                duration: 1,
                role: "other",
              },
            },
          },
        ],
      }),
    );
    const requested = await run([
      "transcribe",
      "offline",
      "--no-wait",
      "--label",
      "CLI request",
      "--json",
    ]);
    assert.ok([0, 1].includes(requested.code), requested.err);
    const requestedResult = JSON.parse(requested.out);
    assert.equal(requestedResult.applied.author, "runtime-cli");
    const pending = await run([
      "wait",
      "transcript",
      "--media",
      "offline",
      "--timeout",
      "0",
      "--json",
    ]);
    assert.equal(pending.code, 1, pending.err);
    assert.equal(JSON.parse(pending.out).ok, false);
    const failed = await run([
      "transcribe",
      "offline",
      "--wait",
      "--timeout",
      "0.2",
      "--label",
      "CLI failed request",
      "--json",
    ]);
    assert.equal(failed.code, 1, failed.err);
    const failedResult = JSON.parse(failed.out);
    assert.equal(failedResult.ok, false);
    if (failedResult.applied) assert.equal(failedResult.applied.author, "runtime-cli");
    Object.assign(evidence, {
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      start,
      comments: { context: comments.comments[0].said, resolved: resolved.revision, undo: true },
      sync: {
        picture: picture.files[0].pictureDelay,
        default: picture.defaultDelay,
        offset: synced.matches[0].offset,
        author: synced.applied.author,
        undo: true,
      },
      wait: { words: waited.finished[0].words, ok: waited.ok, timeoutExit: pending.code },
      transcribe: {
        words: transcribed.files[0].words,
        ok: transcribed.ok,
        failureExit: failed.code,
        failed: failedResult.files,
      },
      diff: { changed: diff.changes.length, baseline },
      restore: { items: restorePreview.items.length, author: restored.applied.author, undo: true },
      clips: { ids: clips.clips.map((c) => c.id) },
      failures,
      limits: [
        "Cached two-word transcript; no model acquisition",
        "Picture-delay defaults persist independently of undo",
        "Sync uses bounded local WAV fixture",
        "Wait progress is final-result text rather than native SSE progress",
        "Windows runtime; native platforms unverified",
      ],
    });
    await writeFile(
      join(root, "docs/verification/cli-analysis-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    resultCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", () => app.exit(resultCode));
    app.quit();
  }
}
void verify();
