// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-export-presets-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let code = 0;
async function wait(predicate) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Export preset runtime timed out");
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
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    const endpoint = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, input = {}) => {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const initial = (await call("timeline", { format: "json" })).project;
    await call("apply", {
      commands: [
        { updateSettings: { patch: { width: 320, height: 180 } } },
        ...[...initial.videoTracks, ...initial.audioTracks].map((track) => ({
          removeTrack: { trackID: track.id },
        })),
        { addTrack: { id: "v", name: "Picture", kind: "video" } },
        {
          insertClip: {
            trackID: "v",
            clip: {
              id: "solid",
              duration: 0.1,
              content: { solid: { color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } } },
            },
          },
        },
      ],
    });
    await wait(() => evaluate("Boolean(document.querySelector('[data-clip-id=solid]'))"));
    await evaluate(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('.editor-export-dialog'))"));
    const select = (label, value) =>
      evaluate(
        `(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    const require = createRequire(join(root, "apps/desktop/package.json")),
      ffprobe = require("ffprobe-static").path;
    const probe = (path) => {
      const r = spawnSync(
        ffprobe,
        ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    const outputs = [];
    const render = async (preset, expected, format, expectedDuration = 0.1) => {
      await select("Export preset", preset);
      if (format != null) await select("Export format", format);
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').disabled",
        ),
        false,
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').click()",
      );
      await wait(() =>
        evaluate("Boolean(document.querySelector('.editor-export-list [download]'))"),
      );
      const download = await evaluate(
        "(async()=>{const e=document.querySelector('.editor-export-list [download]');const b=await (await fetch(e.href)).arrayBuffer();return {name:e.download,bytes:b.byteLength,data:btoa(String.fromCharCode(...new Uint8Array(b)))};})()",
      );
      const path = join(profile, download.name);
      await writeFile(path, Buffer.from(download.data, "base64"));
      const info = probe(path),
        video = info.streams.find((s) => s.codec_type === "video");
      assert.equal(video.width, expected[0]);
      assert.equal(video.height, expected[1]);
      assert.equal(video.codec_name, "vp8");
      assert.ok(Math.abs(Number(info.format.duration) - expectedDuration) < 0.1);
      outputs.push({
        preset,
        name: download.name,
        format: format ?? null,
        width: video.width,
        height: video.height,
        codec: video.codec_name,
        duration: info.format.duration,
        bytes: download.bytes,
      });
      await evaluate(
        "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Remove export').click()",
      );
      await wait(() => evaluate("!document.querySelector('.editor-export-list [download]')"));
    };
    await select("Export preset", "short");
    await wait(() =>
      evaluate("document.querySelector('.editor-export-dialog').textContent.includes('portrait')"),
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').disabled",
      ),
      true,
    );
    await render("webm", [320, 180]);
    await render("review", [1280, 720]);
    await render("youtube1080", [1920, 1080]);
    await call("apply", {
      commands: [
        {
          updateSettings: {
            patch: {
              alternateFormats: [
                { id: "portrait", name: "Portrait", width: 1080, height: 1920 },
                { id: "square", name: "Square", width: 640, height: 640 },
              ],
            },
          },
        },
      ],
    });
    await wait(() => evaluate("Boolean(document.querySelector('[aria-label=\"Export format\"]'))"));
    await render("short", [1080, 1920]);
    await render("webm", [640, 640], "square");
    await call("apply", {
      commands: [{ updateSettings: { patch: { width: 3840, height: 2160 } } }],
    });
    await render("webm", [3840, 2160], "");
    const nativeOutputs = [];
    for (const [preset, width, height, codec] of [
      ["review", 1280, 720, "h264"],
      ["youtube1080", 1920, 1080, "h264"],
      ["short", 1080, 1920, "h264"],
      ["youtube4k", 3840, 2160, "hevc"],
      ["final", 3840, 2160, "h264"],
    ]) {
      const output = await call("export", { preset, to: 0.1, output: `native-${preset}.mp4` });
      const info = probe(output.path),
        video = info.streams.find((stream) => stream.codec_type === "video");
      assert.equal(video.width, width);
      assert.equal(video.height, height);
      assert.equal(video.codec_name, codec);
      assert.equal(Number(video.nb_read_frames), 3);
      nativeOutputs.push({
        preset,
        width,
        height,
        codec,
        frames: Number(video.nb_read_frames),
        duration: info.format.duration,
        warnings: output.warnings,
      });
    }
    if (process.argv.includes("--native-stress")) {
      await call("apply", {
        commands: [{ updateClip: { clipID: "solid", patch: { duration: 30 } } }],
      });
      const results = [];
      for (const [preset, codec] of [
        ["final", "h264"],
        ["youtube4k", "hevc"],
      ]) {
        console.log(JSON.stringify({ startingNativeStress: { preset, codec, duration: 30 } }));
        const began = performance.now();
        const output = await call("export", {
          preset,
          to: 30,
          output: `native-stress-${preset}.mp4`,
        });
        const info = probe(output.path),
          video = info.streams.find((stream) => stream.codec_type === "video");
        assert.equal(video.codec_name, codec);
        assert.equal(video.width, 3840);
        assert.equal(video.height, 2160);
        assert.equal(Number(video.nb_read_frames), 900);
        assert.ok(Math.abs(Number(info.format.duration) - 30) < 0.05);
        results.push({
          preset,
          codec,
          width: video.width,
          height: video.height,
          frames: Number(video.nb_read_frames),
          duration: info.format.duration,
          bytes: Number(info.format.size),
          elapsedSeconds: (performance.now() - began) / 1000,
        });
        console.log(JSON.stringify(results.at(-1)));
      }
      await writeFile(
        join(root, "docs/verification/export-native-stress-runtime.json"),
        JSON.stringify(
          {
            testedAt: new Date().toISOString(),
            platform: process.platform,
            results,
            limits: [
              "Thirty-second static 4K solid without audio",
              "Windows development Electron HTTP export path and bundled FFmpeg",
              "Not long source-video decoding, complex effects, five minutes at 4K, or upstream golden acceptance",
            ],
          },
          null,
          2,
        ) + "\n",
      );
      await call("apply", {
        commands: [{ updateClip: { clipID: "solid", patch: { duration: 0.1 } } }],
      });
    }
    await call("apply", {
      commands: [
        { updateSettings: { patch: { width: 320, height: 180 } } },
        { updateClip: { clipID: "solid", patch: { duration: 2 } } },
      ],
    });
    const key = async (keyCode, modifiers = []) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await new Promise((done) => setTimeout(done, 80));
    };
    await key("Escape");
    await wait(() => evaluate("!document.querySelector('.editor-export-dialog')"));
    await evaluate("document.querySelector('.editor-timeline-scroll').focus()");
    await key("End");
    for (let step = 0; step < 3; step++) await key("Left", ["shift"]);
    await key("i");
    await key("End");
    await key("o");
    await call("apply", {
      commands: [
        {
          addMedia: {
            item: { id: "future-media", path: "future.webm", kind: "video", duration: 1 },
          },
        },
        {
          insertClip: {
            trackID: "v",
            clip: {
              id: "future-missing",
              start: 5,
              duration: 1,
              content: { media: { mediaID: "future-media" } },
            },
          },
        },
        {
          insertClip: {
            trackID: "v",
            clip: {
              id: "future-unsupported",
              start: 600,
              duration: 1,
              content: { graphic: { template: "unsupported-export-fixture" } },
            },
          },
        },
      ],
    });
    await evaluate(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('.editor-export-dialog'))"));
    await select("Export range", "range");
    await render("webm", [320, 180], "", 0.5);
    assert.match(outputs.at(-1).name, /1\.500-2\.000s/);
    await select("Export preset", "wav");
    await evaluate(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('[download$=\".wav\"]'))"));
    const rangedWav = await evaluate(
      "fetch(document.querySelector('[download$=\".wav\"]').href).then(r=>r.arrayBuffer()).then(b=>({bytes:b.byteLength,duration:new DataView(b).getUint32(40,true)/192000}))",
    );
    assert.equal(rangedWav.duration, 0.5);
    assert.equal(rangedWav.bytes, 96044);
    await evaluate(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Remove export').click()",
    );
    await key("Escape");
    await wait(() => evaluate("!document.querySelector('.editor-export-dialog')"));
    await evaluate("document.querySelector('.editor-timeline-scroll').focus()");
    await key("Escape");
    await evaluate(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('.editor-export-dialog'))"));
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').disabled",
      ),
      true,
    );
    assert.match(
      await evaluate("document.querySelector('.editor-export-dialog').innerText"),
      /Mark a non-empty timeline range/,
    );
    await select("Export range", "full");
    await call("apply", {
      commands: [
        { updateClip: { clipID: "solid", patch: { duration: 0.1 } } },
        { removeClips: { clipIDs: ["future-missing", "future-unsupported"] } },
      ],
    });
    // A WAV export must remain possible when the video contains unsupported graphics.
    await call("apply", {
      commands: [
        {
          updateClip: {
            clipID: "solid",
            patch: {
              content: { solid: null, graphic: { template: "unsupported-export-fixture" } },
            },
          },
        },
      ],
    });
    await select("Export preset", "webm");
    await wait(() =>
      evaluate(
        "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').disabled",
      ),
    );
    await select("Export preset", "wav");
    await wait(() =>
      evaluate(
        "![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').disabled",
      ),
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Queue export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('[download$=\".wav\"]'))"));
    const wav = await evaluate(
      "fetch(document.querySelector('[download$=\".wav\"]').href).then(r=>r.arrayBuffer()).then(b=>{const v=new DataView(b);return {magic:String.fromCharCode(...new Uint8Array(b).slice(0,4)),bytes:b.byteLength,sampleRate:v.getUint32(24,true),channels:v.getUint16(22,true)}})",
    );
    assert.equal(wav.magic, "RIFF");
    assert.equal(wav.sampleRate, 48000);
    assert.equal(wav.channels, 2);
    assert.equal(wav.bytes, 19244);
    await evaluate(await readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const accessibility = await evaluate(
      "axe.run(document.querySelector('[role=dialog]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>({violations:r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),passes:r.passes.length}))",
    );
    assert.deepEqual(accessibility.violations, []);
    await writeFile(
      join(profile, "export-dialog.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      outputs,
      nativeOutputs,
      missingPortraitDisablesQueue: true,
      timelineRange: {
        from: 1.5,
        to: 2,
        videoDuration: 0.5,
        wav: rangedWav,
        clearedRangeDisablesQueue: true,
        ignoresUnrelatedMissingAndUnsupportedClips: true,
      },
      wavWithUnsupportedVideo: wav,
      accessibility,
      limits: [
        "Three-frame solid fixtures, not long/4K stress tests",
        "UI WebM VP8/Opus and WAV; desktop MP4/HEVC remain service outputs",
        "Queue stays in memory with five-entry/256MiB limits",
        "Native macOS/Linux and upstream rendered golden comparison unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/export-presets-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    code = 1;
    console.error(error);
  } finally {
    app.once("will-quit", () => app.exit(code));
    app.quit();
  }
}
void verify();
