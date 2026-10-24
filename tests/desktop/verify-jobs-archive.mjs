// Requires build:desktop and the web dev server at 127.0.0.1:4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-jobs-")),
  destination = mkdtempSync(join(tmpdir(), "sidecut-archive-output-"));
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
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, body = {}, expected = 200, signal) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const value = await response.json();
      assert.equal(response.status, expected, `${operation}: ${JSON.stringify(value)}`);
      return value;
    };
    const comments = await call("comments");
    assert.equal(comments.comments[0].said, "Before | After");
    assert.deepEqual(
      comments.comments[0].clips.map((c) => c.track),
      ["V1 Camera", "A1 Voice"],
    );
    await call("comments", { unknown: true }, 400);
    const start = (await call("status")).revision;
    const preview = await call("sync", { files: ["mic"], dryRun: true, expectedRevision: start });
    assert.equal(preview.revision, start);
    assert.ok(preview.applied.dryRun);
    assert.ok(Math.abs(preview.matches[0].offset - 0.25) < 0.001);
    const synced = await call("sync", { files: ["mic"], expectedRevision: start });
    assert.equal(synced.revision, start + 1);
    assert.ok((await call("clips", { media: "mic" })).clips.length);
    await call("sync", { files: ["mic"], to: "mic" }, 400);
    await call("sync", { files: ["mic"], expectedRevision: start }, 409);
    await call("undo");
    assert.equal((await call("clips", { media: "mic" })).clips.length, 0);
    await call("sync", { delay: 0.08, makeDefault: true });
    assert.equal((await call("sync")).defaultDelay, 0.08);
    await call("sync", { delay: 80 }, 400);
    const beforeResolve = (await call("status")).revision;
    const watching = call("watch", { revision: beforeResolve, timeout: 2 });
    await call("apply", {
      label: "Resolve comment",
      commands: [{ removeMarker: { markerID: "comment" } }],
    });
    const watched = await watching;
    assert.equal(watched.changed, true);
    assert.equal(watched.events[0].label, "Resolve comment");
    assert.deepEqual((await call("watch", { revision: beforeResolve })).events, watched.events);
    assert.equal((await call("watch", { timeout: 0.01 })).changed, false);
    const controller = new AbortController(),
      cancelled = call("watch", { timeout: 60 }, 200, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(cancelled);
    const transcriptWait = await call("wait", {
      what: "transcript",
      media: ["camera"],
      timeout: 86400,
    });
    assert.equal(transcriptWait.done, true);
    assert.equal(transcriptWait.finished[0].words, 2);
    await call("wait", { what: "matte", media: ["mic"], timeout: 0 }, 400);
    await call("wait", { what: "unknown" }, 400);
    const rendering = call("clip", {
      start: 0,
      end: 1,
      audioOnly: true,
      output: "wait-export.wav",
    });
    await new Promise((done) => setTimeout(done, 20));
    const exportWait = await call("wait", { what: "export", timeout: 30 });
    await rendering;
    assert.equal(exportWait.done, true);
    const dry = await call("archive", { to: destination, dryRun: true, withCache: true });
    await assert.rejects(stat(dry.folder));
    const archived = await call("archive", { to: destination, withCache: true });
    assert.ok(archived.collected.some((c) => c.kind === "cache"));
    const portable = await readFile(archived.openFile);
    assert.equal(portable.readUInt32LE(0), 0x04034b50);
    assert.equal((await call("status")).revision, archived.revision);
    await call("archive", { to: destination }, 400);
    const consolidated = await call("archive", {});
    assert.equal(consolidated.mode, "consolidate");
    const consolidatedLUT = await evaluate(
      `(async()=>{const path=fixtureSession.getSnapshot().project.media.find(m=>m.id==='camera').look[0].params.path;return {path,available:(await fixtureSession.resource('lut:'+path))?.state==='available'};})()`,
    );
    assert.equal(consolidatedLUT.available, true);
    assert.ok((await call("media")).items.every((m) => m.path.startsWith("media/")));
    await call("undo");
    assert.ok((await call("media")).items.some((m) => m.path === "camera.wav"));
    const restored = await evaluate(`(async()=>{
      const {derivedCache}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/derived-cache.ts")});
      await derivedCache(cacheKey,{model:'wrong',language:'en',words:[]});
      await fixtureSession.openProject(new File([Uint8Array.from(atob(${JSON.stringify(portable.toString("base64"))}),c=>c.charCodeAt(0))],'restored.sidecut'));
      const {readZip}=await import(${JSON.stringify(fsRoot + "/packages/core/src/archive.ts")});
      const entries=readZip(await fixtureSession.archiveBytes());
      const withoutCache=JSON.parse(new TextDecoder().decode(entries['manifest.json'])).resources.every(r=>!r.key.startsWith('cache:'));
      await fixtureSession.archiveBytes({withCache:true});
      return {cache:await derivedCache(cacheKey),source:(await fixtureSession.resource('camera')).file.size,withoutCache};
    })()`);
    assert.equal(restored.cache.words.length, 2);
    assert.equal(restored.withoutCache, true);
    assert.ok(restored.source > 0);
    Object.assign(evidence, {
      comments: comments.comments[0],
      sync: {
        offset: synced.matches[0].offset,
        confidence: synced.matches[0].confidence,
        oneUndoStep: true,
      },
      watch: { replay: watched.events, cancellation: true, timeout: true },
      wait: { transcript: transcriptWait, export: exportWait },
      archive: {
        resources: archived.collected.length,
        cache: true,
        portableBytes: portable.length,
        dryRun: true,
        consolidateUndo: true,
        restoredWords: restored.cache.words.length,
      },
    });
    await writeFile(
      join(root, "docs/verification/jobs-archive-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/jobs-archive-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    resultCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", (event) => {
      event.preventDefault();
      void Promise.allSettled([
        rm(profile, { recursive: true, force: true }),
        rm(destination, { recursive: true, force: true }),
      ]).finally(() => app.exit(resultCode));
    });
    app.quit();
  }
}
void verify();
