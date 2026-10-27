import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve, isAbsolute } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const profile = process.env.SIDECUT_LONG_DELIVERY_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const require = createRequire(join(root, "apps/desktop/package.json"));
const ffmpeg = require("ffmpeg-static"),
  ffprobe = require("ffprobe-static").path;
const report = {
  testedAt: new Date().toISOString(),
  production: true,
  syntheticInputs: true,
  physicalCapture: false,
  accepted: false,
  checks: Object.fromEntries(
    [
      "source",
      "project",
      "range",
      "queue",
      "output",
      "samples",
      "timingComparison",
      "resourceBounds",
    ].map((k) => [k, { status: "notrun" }]),
  ),
  errors: [],
  limits: [
    "Synthetic accelerated media is not a physical capture or a measured 60-minute session.",
    "Resource observations are sampled process memory and profile disk use, not system-wide peaks.",
  ],
};
let stage = "source";
function run(bin, args, encoding) {
  const r = spawnSync(bin, args, {
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    encoding,
  });
  assert.equal(r.status, 0, `${bin}: ${r.stderr || r.error}`);
  return r.stdout;
}
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Timed out: " + label);
}
function size(path) {
  try {
    const s = statSync(path);
    return s.isDirectory()
      ? readdirSync(path).reduce((n, f) => n + size(join(path, f)), 0)
      : s.size;
  } catch {
    return 0;
  }
}
async function verify() {
  try {
    const id = randomUUID(),
      folder = join(profile, "native-recordings", id),
      source = join(folder, "recording.mp4");
    mkdirSync(folder, { recursive: true });
    run(
      ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=2:duration=612,drawbox=x=0:y=0:w=iw:h=30:color=red:t=fill:enable='lt(t,204)',drawbox=x=0:y=0:w=iw:h=30:color=lime:t=fill:enable='between(t,204,407.999)',drawbox=x=0:y=0:w=iw:h=30:color=blue:t=fill:enable='gte(t,408)'",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=0.1*sin(2*PI*if(lt(t\\,204)\\,330\\,if(lt(t\\,408)\\,660\\,990))*t):s=8000:d=612",
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
        source,
      ],
      "utf8",
    );
    const info = JSON.parse(
      run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", source], "utf8"),
    );
    assert.ok(Number(info.format.duration) >= 612);
    assert.ok(
      info.streams.some((s) => s.codec_type === "audio") &&
        info.streams.some((s) => s.codec_type === "video"),
    );
    const recording = {
      id,
      projectID: "long-delivery",
      source: "camera",
      createdAt: new Date().toISOString(),
      status: "ready",
      encoder: "libx264",
      elapsedSeconds: Number(info.format.duration),
      bytes: statSync(source).size,
      tracks: info.streams
        .filter((s) => ["video", "audio"].includes(s.codec_type))
        .map((s) => ({
          kind: s.codec_type,
          startSeconds: Number(s.start_time),
          durationSeconds: Number(s.duration),
        })),
      error: null,
    };
    writeFileSync(join(folder, "metadata.json"), JSON.stringify(recording));
    report.checks.source = {
      status: "pass",
      durationSeconds: Number(info.format.duration),
      bytes: recording.bytes,
      paddingBytes: 0,
    };
    stage = "project";
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const win = await until(() => BrowserWindow.getAllWindows()[0], "window");
    win.setContentSize(1440, 960);
    win.show();
    win.webContents.setBackgroundThrottling(false);
    const ev = (s) => win.webContents.executeJavaScript(s, true);
    await until(
      () =>
        ev("Boolean(document.querySelector('.editor-workspace') && window.sidecutDesktop)").catch(
          () => false,
        ),
      "editor",
    );
    const section =
      "[...document.querySelectorAll('details')].find(s => s.querySelector('summary')?.textContent.includes('Native recording library'))";
    await until(() => ev(`Boolean(${section})`), "library");
    await ev(`${section}.open=true`);
    const row = `[...(${section}).querySelectorAll('li')].find(li=>li.textContent.includes('camera ·'))`;
    await until(() => ev(`Boolean(${row})`), "recording");
    await ev(
      `[...(${row}).querySelectorAll('button')].find(b=>b.textContent.trim()==='Add to project').click()`,
    );
    const imported = await until(
      async () => {
        const p = await ev(
          "JSON.parse(window.sidecutDesktop.projectRequest(JSON.stringify({type:'snapshot'})).snapshot.json).project",
        );
        return p.media.find((m) => m.nativeRecording?.id === id) && p;
      },
      "import",
      120000,
    );
    const mediaID = imported.media.find((m) => m.nativeRecording?.id === id).id;
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (op, input = {}) => {
      const r = await fetch(`http://127.0.0.1:${discovery.port}/v1/${op}`, {
        method: "POST",
        headers: { authorization: "Bearer " + discovery.token, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      return body;
    };
    const commands = [
      ...[...imported.videoTracks, ...imported.audioTracks].map((t) => ({
        removeTrack: { trackID: t.id },
      })),
      {
        updateSettings: {
          patch: { width: 160, height: 90, frameRate: { numerator: 2, denominator: 1 } },
        },
      },
      { addTrack: { id: "picture", name: "Picture", kind: "video" } },
      { addTrack: { id: "overlay", name: "Overlay", kind: "video" } },
      { addTrack: { id: "sound", name: "Sound", kind: "audio" } },
      { addTrack: { id: "range", name: "Range selection", kind: "video" } },
    ];
    for (let i = 0; i < 3; i++)
      commands.push({
        insertClip: {
          trackID: "picture",
          clip: {
            id: `picture-${i}`,
            start: i * 204,
            duration: 204,
            sourceStart: [408, 0, 204][i],
            content: { media: { mediaID } },
          },
        },
      });
    for (let i = 0; i < 3; i++)
      commands.push({
        insertClip: {
          trackID: "sound",
          clip: {
            id: `sound-${i}`,
            start: i * 204,
            duration: 204,
            sourceStart: [408, 0, 204][i],
            content: { media: { mediaID } },
            audio: {
              gainDB: -3,
              fadeIn: 2,
              fadeOut: 2,
              effects: [
                {
                  id: `compress-${i}`,
                  type: "compressor",
                  enabled: true,
                  params: { threshold: -20, ratio: 4 },
                },
                {
                  id: `cleanup-${i}`,
                  type: "voiceCleanup",
                  enabled: true,
                  params: { highPass: 60 },
                },
                { id: `limit-${i}`, type: "limiter", enabled: true, params: {} },
              ],
            },
          },
        },
      });
    commands.push({
      insertClip: {
        trackID: "overlay",
        clip: {
          id: "title",
          start: 205,
          duration: 20,
          content: { text: { text: "Long delivery" } },
        },
      },
    });
    await call("apply", { label: "Long delivery synthetic fixture", commands });
    const project = (await call("timeline", { format: "json" })).project;
    assert.equal(project.videoTracks.find((t) => t.id === "picture").clips.length, 3);
    assert.equal(project.audioTracks.find((t) => t.id === "sound").clips.length, 3);
    report.checks.project = {
      status: "pass",
      mediaID,
      clips: 6,
      overlay: "text",
      effects: ["compressor", "voiceCleanup", "limiter"],
      fadesSeconds: 2,
      frameRate: project.settings.frameRate,
    };
    stage = "range";
    await ev(`document.querySelector('[aria-label="Fit"]').click()`);
    await until(
      () =>
        ev(
          `Boolean(document.querySelector('[data-track-id="range"].editor-track-lane') && document.querySelector('[data-clip-id="picture-0"]'))`,
        ),
      "range lane",
    );
    const geometry = await ev(
      `(()=>{const lane=document.querySelector('[data-track-id="range"].editor-track-lane').getBoundingClientRect(), clip=document.querySelector('[data-clip-id="picture-0"]').getBoundingClientRect(); return {x:lane.left,y:lane.top+lane.height/2,scale:clip.width/204};})()`,
    );
    const mouse = (type, time, modifiers = []) =>
      win.webContents.sendInputEvent({
        type,
        x: Math.round(geometry.x + geometry.scale * time),
        y: Math.round(geometry.y),
        button: "left",
        clickCount: 1,
        modifiers,
      });
    mouse("mouseMove", 1);
    mouse("mouseDown", 1, ["shift"]);
    mouse("mouseMove", 611, ["shift", "leftButtonDown"]);
    mouse("mouseUp", 611, ["shift"]);
    stage = "queue";
    const button = (label) =>
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
    await ev(button("Export") + ".click()");
    await until(
      () => ev("Boolean(document.querySelector('[aria-label=\"Export range\"]'))"),
      "export dialog",
    );
    await ev(
      `(()=>{const e=document.querySelector('[aria-label="Video encoding"]'); if(!e) throw Error('native encoding unavailable'); e.value='h264'; e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await ev(
      `(()=>{const e=document.querySelector('[aria-label="Export range"]'); const option=e.querySelector('option[value=range]'); if(!option || option.disabled) throw Error('Nonzero timeline range was not selected'); e.value='range';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await ev(button("Queue export") + ".click()");
    const recipe = await until(
      () =>
        ev(
          `window.sidecutDesktop.storageRequest({type:'read',collection:'deliveries'}).then(rows=>rows.map(row=>JSON.parse(row.value))[0]?.recipe)`,
        ),
      "frozen range recipe",
    );
    assert.ok(
      recipe.startSeconds > 0 &&
        Math.abs(recipe.startSeconds - 1) <= 0.5 &&
        recipe.durationSeconds >= 600 &&
        recipe.startSeconds + recipe.durationSeconds < 612,
    );
    const rangeStart = recipe.startSeconds;
    report.checks.range = {
      status: "pass",
      startSeconds: rangeStart,
      durationSeconds: recipe.durationSeconds,
      sourceOrder: [408, 0, 204],
    };
    const observations = [];
    const started = Date.now();
    await until(
      async () => {
        const q = await ev(
          `(()=>{const q=document.querySelector('[aria-label="Export queue"]'); return {text:q?.textContent,done:Boolean(q?.querySelector('a[download]'))};})()`,
        );
        observations.push({
          elapsedSeconds: (Date.now() - started) / 1000,
          processWorkingSetKB: app
            .getAppMetrics()
            .reduce((n, p) => n + (p.memory?.workingSetSize || 0), 0),
          profileBytes: size(profile),
        });
        if (/failed/i.test(q.text ?? "")) throw Error(q.text);
        return q.done;
      },
      "queue export",
      1800000,
    );
    report.checks.queue = { status: "pass", elapsedSeconds: (Date.now() - started) / 1000 };
    assert.ok(
      Math.max(...observations.map((o) => o.processWorkingSetKB)) < 4 * 1024 * 1024,
      "sampled working set exceeded 4 GiB",
    );
    assert.ok(
      Math.max(...observations.map((o) => o.profileBytes)) < 4 * 1024 ** 3,
      "sampled profile disk use exceeded 4 GiB",
    );
    report.checks.resourceBounds = {
      status: "pass",
      workingSetLimitKB: 4 * 1024 * 1024,
      profileLimitBytes: 4 * 1024 ** 3,
      samples: observations.length,
      peakWorkingSetKB: Math.max(...observations.map((o) => o.processWorkingSetKB)),
      peakProfileBytes: Math.max(...observations.map((o) => o.profileBytes)),
      first: observations[0],
      last: observations.at(-1),
    };
    stage = "output";
    const output = join(profile, "long-delivery-output.mp4");
    const download = new Promise((complete, reject) =>
      win.webContents.session.once("will-download", (_event, item) => {
        item.setSavePath(output);
        item.once("done", (_doneEvent, state) =>
          state === "completed" ? complete() : reject(Error("Download " + state)),
        );
      }),
    );
    await ev("document.querySelector('[aria-label=\"Export queue\"] a[download]').click()");
    await download;
    const probe = JSON.parse(
      run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], "utf8"),
    );
    assert.ok(probe.streams.some((s) => s.codec_name === "h264"));
    assert.ok(probe.streams.some((s) => s.codec_type === "audio"));
    assert.ok(Math.abs(Number(probe.format.duration) - recipe.durationSeconds) < 0.1);
    report.checks.output = {
      status: "pass",
      durationSeconds: Number(probe.format.duration),
      bytes: statSync(output).size,
      streams: probe.streams.map((s) => ({
        type: s.codec_type,
        codec: s.codec_name,
        start: Number(s.start_time),
        duration: Number(s.duration),
      })),
    };
    stage = "samples";
    const samples = [];
    for (const time of [5, 100, 210, 306, 420, 510, 605]) {
      const frame = run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      assert.ok(frame.length > 0);
      const audio = run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-t",
        "0.5",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
      assert.ok(audio.length > 0);
      let sum = 0;
      for (let i = 0; i + 1 < audio.length; i += 2) sum += audio.readInt16LE(i) ** 2;
      const sampleRms = Math.sqrt(sum / (audio.length / 2));
      samples.push({
        time,
        frameHash: createHash("sha256").update(frame).digest("hex"),
        audioRms: sampleRms,
      });
    }
    assert.ok(new Set(samples.map((s) => s.frameHash)).size >= 5);
    assert.ok(samples.every((s) => s.audioRms > 10));
    report.checks.samples = { status: "pass", samples };
    stage = "timingComparison";
    const comparisons = [];
    function audioAt(time, duration = 0.25) {
      return run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-t",
        String(duration),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
    }
    function rms(audio) {
      let sum = 0;
      for (let i = 0; i + 1 < audio.length; i += 2) sum += audio.readInt16LE(i) ** 2;
      return Math.sqrt(sum / (audio.length / 2));
    }
    function tonePower(audio, frequency) {
      let real = 0,
        imaginary = 0;
      for (let i = 0; i < audio.length / 2; i++) {
        const value = audio.readInt16LE(i * 2);
        real += value * Math.cos((2 * Math.PI * frequency * i) / 8000);
        imaginary += value * Math.sin((2 * Math.PI * frequency * i) / 8000);
      }
      return real * real + imaginary * imaginary;
    }
    for (const [projectTime, frequency, channel] of [
      [12, 990, 2],
      [240, 330, 0],
      [450, 660, 1],
    ]) {
      const time = projectTime - rangeStart;
      const frame = run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      const pixel = [...frame.subarray((5 * 160 + 5) * 3, (5 * 160 + 5) * 3 + 3)];
      assert.ok(
        pixel[channel] > 140 && pixel.every((value, index) => index === channel || value < 90),
        `Wrong clip color at ${projectTime}s: ${pixel}`,
      );
      const audio = audioAt(time),
        powers = [330, 660, 990].map((value) => ({
          frequency: value,
          power: tonePower(audio, value),
        }));
      const expected = powers.find((value) => value.frequency === frequency).power,
        other = Math.max(
          ...powers.filter((value) => value.frequency !== frequency).map((value) => value.power),
        );
      assert.ok(
        expected > other * 10,
        `Wrong source tone at ${projectTime}s: ${JSON.stringify(powers)}`,
      );
      comparisons.push({
        projectTime,
        outputTime: time,
        expectedFrequency: frequency,
        pixel,
        tonePowerRatio: expected / Math.max(1, other),
      });
    }
    const fades = [];
    for (const boundary of [204, 408]) {
      const baseline = rms(audioAt(boundary + 6 - rangeStart));
      const before = rms(audioAt(boundary - 0.12 - rangeStart, 0.08)),
        after = rms(audioAt(boundary + 0.04 - rangeStart, 0.08));
      assert.ok(
        before < baseline * 0.3 && after < baseline * 0.3,
        `Missing fades at ${boundary}s: ${before}, ${after}, baseline ${baseline}`,
      );
      fades.push({
        projectBoundary: boundary,
        outputBoundary: boundary - rangeStart,
        beforeRms: before,
        afterRms: after,
        baselineRms: baseline,
      });
    }
    report.checks.timingComparison = {
      status: "pass",
      comparisons,
      fades,
      durationToleranceSeconds: 0.1,
    };
  } catch (error) {
    if (report.checks[stage]) report.checks[stage] = { status: "fail" };
    report.errors.push({ stage, error: error.stack ?? String(error) });
  } finally {
    report.accepted = Object.values(report.checks).every((c) => c.status === "pass");
    await writeFile(
      join(root, "docs/verification/lawn-videorc-long-delivery.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
    app.exit(report.accepted ? 0 : 1);
  }
}
void verify();
