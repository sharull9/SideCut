// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-render-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let exitCode = 0;
async function wait(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Runtime timed out");
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
    const evaluate = (code) => window.webContents.executeJavaScript(`(async()=>(${code}))()`, true);
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    await evaluate(
      `(async()=>{const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();})()`,
    );
    const run = (args, stdin = "") =>
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
        child.stdin.end(stdin);
      });
    const success = async (args, stdin) => {
      const result = await run(args, stdin);
      assert.equal(result.code, 0, result.err);
      return result.out;
    };
    const json = async (...args) => JSON.parse(await success([...args, "--json"]));
    const source = await evaluate("fixtureSession.projectFile().project.id");
    const wav = Buffer.alloc(44 + 32000);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(32000, 40);
    for (let i = 0; i < 16000; i++)
      wav.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 8000)), 44 + i * 2);
    await json(
      "apply",
      JSON.stringify({
        commands: [
          { updateSettings: { patch: { width: 320, height: 180 } } },
          { addTrack: { id: "video", name: "CLI colour", kind: "video" } },
          {
            insertClip: {
              trackID: "video",
              clip: {
                id: "colour",
                duration: 2,
                content: { solid: { color: { r: 0.8, g: 0.2, b: 0.1, a: 1 } } },
              },
            },
          },
          { addTrack: { id: "voice-track", name: "CLI Voice", kind: "audio" } },
          {
            addMedia: {
              item: {
                id: "voice",
                path: "voice.wav",
                kind: "audio",
                hasAudio: true,
                duration: 2,
                role: "camera",
              },
            },
          },
          {
            insertClip: {
              trackID: "voice-track",
              clip: { id: "voice-clip", duration: 2, content: { media: { mediaID: "voice" } } },
            },
          },
        ],
      }),
    );
    await evaluate(
      `fixtureSession.stageServiceResource(${JSON.stringify(source)},'voice',new File([Uint8Array.from(atob(${JSON.stringify(wav.toString("base64"))}),c=>c.charCodeAt(0))],'voice.wav',{type:'audio/wav'}),new AbortController().signal)`,
    );
    await wait(() =>
      evaluate(
        "fixtureSession.getSnapshot().project.videoTracks.some(t=>t.id==='video'&&t.clips.length===1)",
      ),
    );
    const before = await evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      revision = Number(await success(["status", "--revision"]));
    const unchanged = async () => {
      assert.equal(await evaluate("JSON.stringify(fixtureSession.projectFile().project)"), before);
      assert.equal(Number(await success(["status", "--revision"])), revision);
    };
    const png = async (path) => {
      const bytes = await readFile(path);
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      return { bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    };
    const frames = await json("frames", "1", "0", "1", "--width", "96");
    assert.deepEqual(frames.times, [0, 1]);
    assert.ok(frames.path.endsWith("frames-00.00.000-00.01.000.png"));
    const sheet = await png(frames.path);
    assert.equal(sheet.width, frames.width);
    assert.equal(sheet.height, frames.height);
    const interval = await json(
      "project",
      "frames",
      "--every",
      "0.5",
      "--from",
      "0",
      "--to",
      "1",
      "--width",
      "96",
    );
    assert.deepEqual(interval.times, [0, 0.5, 1]);
    assert.ok(interval.path.endsWith("frames-every-0.5s-00.00.000-00.01.000.png"));
    assert.match(
      await success(["frames", "0", "--width", "96", "-o", "readable sheet.png"]),
      /1 frame, at 00:00.000/,
    );
    const screenshot = await json("screenshot");
    assert.ok(screenshot.path.endsWith("sidecut-window.png"));
    const captured = await png(screenshot.path);
    assert.ok(captured.width > 320 && captured.height > 180);
    assert.match(
      await success(["screenshot", "-o", "readable window.png"]),
      /Wrote .*readable window.png/,
    );
    const clip = await json(
      "clip",
      "0.25",
      "1.25",
      "--audio-only",
      "--tracks",
      "CLI Voice",
      "-o",
      "voice clip.wav",
    );
    assert.equal(clip.duration, 1);
    assert.deepEqual(clip.tracks, ["CLI Voice"]);
    assert.equal(clip.codec, "pcm_s16le");
    const require = createRequire(join(root, "apps/desktop/package.json")),
      probePath = require("ffprobe-static").path;
    const probe = (path) => {
      const result = spawnSync(
        probePath,
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const sound = probe(clip.path);
    assert.equal(sound.streams[0].sample_rate, "48000");
    assert.equal(sound.streams[0].channels, 2);
    assert.ok(Math.abs(Number(sound.format.duration) - 1) < 0.01);
    const clipBytes = await readFile(clip.path);
    assert.ok(clipBytes.subarray(44).some((v) => v !== 0));
    assert.match(
      await success([
        "clip",
        "0",
        "0.5",
        "--audio-only",
        "--tracks",
        "CLI Voice",
        "-o",
        "readable clip.wav",
      ]),
      /sound only.*Only CLI Voice plays/s,
    );
    const exported = await json(
      "export",
      "--preset",
      "final",
      "--from",
      "0",
      "--to",
      "0.5",
      "-o",
      "movie.mp4",
    );
    const video = probe(exported.path),
      videoStream = video.streams.find((s) => s.codec_type === "video");
    assert.equal(videoStream.codec_name, "h264");
    assert.equal(videoStream.width, 320);
    assert.equal(videoStream.height, 180);
    assert.ok(Math.abs(Number(video.format.duration) - 0.5) < 0.1);
    const snapshot = JSON.parse(await readFile(exported.path + ".tandem", "utf8"));
    assert.equal(snapshot.revision, revision);
    const movieBytes = await readFile(exported.path);
    assert.match(
      await success(["export", "--preset", "webm", "--to", "0.5", "-o", "readable.webm"]),
      /Wrote .*readable.webm/,
    );
    const loudness = await json("loudness", "voice");
    assert.equal(loudness.media[0].mediaID, "voice");
    assert.equal(loudness.media[0].state, "ready");
    assert.ok(Number.isFinite(loudness.media[0].integratedLUFS));
    assert.match(await success(["loudness", "voice"]), /Speech is levelled.*voice.wav/s);
    const curveArgs = [
      "loudness",
      "--from",
      "0",
      "--to",
      "1",
      "--step",
      "0.2",
      "--tracks",
      "CLI Voice",
      "--gains",
      "--over",
      "-30",
    ];
    const curve = await json(...curveArgs);
    assert.equal(curve.curve.points.length, 6);
    assert.ok(curve.peaks.windows > 0);
    assert.equal(curve.gains[0].track, "CLI Voice");
    assert.ok(curve.gains[0].compared > 0);
    assert.match(await success(curveArgs), /window.*peak.*Gain lanes against the render/s);
    await unchanged();
    const failures = [];
    for (const args of [
      ["frames"],
      ["frames", "99"],
      ["frames", "0", "-o", "../escape.png"],
      ["screenshot"],
      ["screenshot", "extra"],
      ["clip", "1", "0"],
      ["clip", "0", "1", "--audio-only", "--tracks", "missing"],
      ["export", "--preset", "missing"],
      ["export", "--to", "99"],
      ["export", "--preset", "final", "--to", "0.5", "-o", "movie.mp4"],
      ["loudness", "missing"],
      ["loudness", "--from", "0", "--to", "1", "--step", "0"],
      ["loudness", "--tracks", "missing"],
    ]) {
      const result = await run(args);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      failures.push({ args, code: result.code });
      await unchanged();
    }
    assert.deepEqual(await readFile(exported.path), movieBytes);
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      revision,
      frames: { times: frames.times, ...sheet, interval: interval.times },
      screenshot: captured,
      clip: {
        duration: clip.duration,
        codec: clip.codec,
        tracks: clip.tracks,
        sampleRate: sound.streams[0].sample_rate,
        channels: sound.streams[0].channels,
        nonSilent: true,
      },
      export: {
        duration: video.format.duration,
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        snapshotRevision: snapshot.revision,
        originalPreserved: true,
      },
      loudness: {
        media: loudness.media[0],
        curve: {
          points: curve.curve.points.length,
          integratedLUFS: curve.curve.integratedLUFS,
          peaks: curve.peaks.windows,
          gains: curve.gains,
        },
      },
      failures,
      projectUnchanged: true,
      limits: [
        "Windows development Electron runtime",
        "Short local sine/solid fixture; no long or 4K encoder stress test",
        "Managed exclusive output names and SideCut transport codes retained",
        "Native macOS/Linux and upstream rendering comparison unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-render-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", () => app.exit(exitCode));
    app.quit();
  }
}
void verify();
