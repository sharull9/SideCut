import { app, BrowserWindow, dialog, systemPreferences } from "electron";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = process.env.SIDECUT_NATIVE_TEST_PROFILE;
assert.ok(profile && isAbsolute(profile));
const stage = process.env.SIDECUT_NATIVE_TEST_STAGE;
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const require = createRequire(join(root, "apps/desktop/package.json"));
const processes = require("node:child_process"),
  originalSpawn = processes.spawn;
const ffmpeg = require("ffmpeg-static"),
  ffprobe = require("ffprobe-static").path;
let capture;
const hardwareProbes = new Set();
// Intercept only the input adapter in this fixture. The production engine, codecs and files are real.
processes.spawn = (binary, args, options) => {
  if (binary === ffmpeg && args.includes("-frames:v")) {
    const encoder = args[args.indexOf("-c:v") + 1];
    if (["h264_nvenc", "h264_qsv", "h264_amf"].includes(encoder)) hardwareProbes.add(encoder);
  }
  if (binary === ffmpeg && args.includes("-list_devices")) {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stderr.write(
        '[dshow @ fixture] "Synthetic camera" (video)\n[dshow @ fixture] "Synthetic microphone" (audio)\n',
      );
      child.stderr.end();
      child.emit("close", 1);
    });
    return child;
  }
  if (binary === ffmpeg && (args.includes("gdigrab") || args.includes("dshow"))) {
    const mapped = [];
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "-thread_queue_size") {
        index++;
        continue;
      }
      if (args[index] === "-framerate") {
        index++;
        continue;
      }
      if (args[index] === "-f" && ["gdigrab", "dshow"].includes(args[index + 1])) {
        index++;
        continue;
      }
      if (args[index] === "-i") {
        const input = args[++index];
        assert.ok(input === "desktop" || input.startsWith("audio=") || input.startsWith("video="));
        mapped.push(
          "-re",
          "-f",
          "lavfi",
          "-i",
          input.startsWith("audio=")
            ? "sine=frequency=440:sample_rate=48000"
            : "testsrc2=size=320x180:rate=30",
        );
      } else mapped.push(args[index]);
    }
    capture = originalSpawn(binary, mapped, options);
    return capture;
  }
  return originalSpawn(binary, args, options);
};
syncBuiltinESMExports();
const reportPath = join(root, "docs/verification/lawn-videorc-native-recorder.json");
const report =
  stage === "recover"
    ? JSON.parse(await readFile(reportPath, "utf8"))
    : {
        testedAt: new Date().toISOString(),
        platform: process.platform,
        production: true,
        syntheticInputs: true,
        simulatedConfirmation: true,
        projectLockRecovery:
          "Fixture removes its disposable stale project lock only after the previous host exits.",
        checks: {},
        errors: [],
        accepted: false,
      };
async function until(task) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const result = await task();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("Native recorder fixture timed out");
}
async function inspect(path) {
  const child = originalSpawn(
    ffprobe,
    ["-v", "error", "-show_streams", "-show_format", "-count_packets", "-of", "json", path],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0);
  const probe = JSON.parse(output);
  return {
    duration: Number(probe.format.duration),
    bytes: Number(probe.format.size),
    streams: probe.streams.map((stream) => ({
      kind: stream.codec_type,
      codec: stream.codec_name,
      start: Number(stream.start_time),
      duration: Number(stream.duration),
      packets: Number(stream.nb_read_packets),
    })),
  };
}
async function verify() {
  try {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    systemPreferences.getMediaAccessStatus = () => "granted";
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await until(async () => BrowserWindow.getAllWindows()[0]);
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
    });
    if (stage === "record") {
      await evaluate(
        `[...document.querySelectorAll('details')].find(section => section.querySelector('summary')?.textContent.includes('Native recording')).open = true`,
      );
      await until(() =>
        evaluate(
          "Boolean(document.querySelector('#native-device') || document.querySelector('#native-mic option[value]:not([value=\"\"])'))",
        ),
      );
      await evaluate(`(() => {
        const select = document.querySelector('#native-source'); select.value = 'camera'; select.dispatchEvent(new Event('change', {bubbles:true}));
      })()`);
      await until(() =>
        evaluate(
          "document.querySelector('#native-device option[value]:not([value=\"\"])') !== null",
        ),
      );
      await evaluate(`(() => {
        for (const id of ['native-device','native-mic']) { const select = document.getElementById(id); select.value = [...select.options].find(option => option.value).value; select.dispatchEvent(new Event('change',{bubbles:true})); }
        const encoder = document.querySelector('#native-encoder'); encoder.value = 'auto'; encoder.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      const section = `[...document.querySelectorAll('details')].find(section => section.querySelector('summary')?.textContent.includes('Native recording'))`;
      await evaluate(
        `[...(${section}).querySelectorAll('button')].find(button => button.textContent.trim() === 'Start recording').click()`,
      );
      await until(() =>
        evaluate(
          `Boolean([...(${section}).querySelectorAll('button')].find(button => button.textContent.trim() === 'Stop recording'))`,
        ),
      );
      await new Promise((done) => setTimeout(done, 2200));
      await evaluate(
        `[...(${section}).querySelectorAll('button')].find(button => button.textContent.trim() === 'Stop recording').click()`,
      );
      const ready = await until(async () =>
        (await evaluate("window.sidecutDesktop.nativeRecordingList()")).find(
          (item) => item.status === "ready",
        ),
      );
      const media = await inspect(join(profile, "native-recordings", ready.id, "recording.mp4"));
      assert.deepEqual(media.streams.map((stream) => stream.codec).sort(), ["aac", "h264"]);
      assert.ok(media.streams.every((stream) => stream.packets > 0 && stream.duration > 0));
      assert.ok(media.duration > 1);
      assert.ok(
        (await stat(join(profile, "native-recordings", ready.id, "recording.mkv"))).size > 0,
      );
      report.checks.uiRecordStop = media;
      report.checks.encoder = ready.encoder;
      report.checks.hardwareProbes = [...hardwareProbes];
      report.checks.noHostPathsOnWire = !JSON.stringify(ready).includes(profile);
      assert.equal(report.checks.noHostPathsOnWire, true);
      const microphone = await evaluate(`(async () => {
        const mic = (await window.sidecutDesktop.nativeRecordingDevices()).find(device => device.kind === 'microphone');
        return window.sidecutDesktop.nativeRecordingStart({projectID:'microphone-fixture',source:'microphone',deviceID:mic.id,encoder:'software'});
      })()`);
      await new Promise((done) => setTimeout(done, 1500));
      const audio = await evaluate("window.sidecutDesktop.nativeRecordingStop()");
      assert.equal(audio.status, "ready", audio.error ?? "microphone failed");
      report.checks.microphoneOnly = await inspect(
        join(profile, "native-recordings", microphone.id, "recording.mp4"),
      );
      assert.deepEqual(
        report.checks.microphoneOnly.streams.map((stream) => stream.codec),
        ["aac"],
      );
      assert.ok(report.checks.microphoneOnly.duration > 0);
      const partial = await evaluate(
        `window.sidecutDesktop.nativeRecordingStart({projectID:'recovery-fixture',source:'screen',encoder:'software'})`,
      );
      await new Promise((done) => setTimeout(done, 2200));
      assert.ok(
        (await stat(join(profile, "native-recordings", partial.id, "recording.mkv"))).size > 0,
      );
      report.recoveryID = partial.id;
      report.checks.interruptedSourceWritten = true;
      // End only the fixture's owned encoder; exit before its completion callback can rewrite the journal.
      capture.kill();
      report.checks.captureKilledForRecovery = true;
    } else {
      const rows = await evaluate("window.sidecutDesktop.nativeRecordingList()");
      const interrupted = rows.find((item) => item.id === report.recoveryID);
      assert.ok(["interrupted", "error"].includes(interrupted?.status));
      report.checks.recoveredStatus = interrupted.status;
      const ready = await evaluate(
        `window.sidecutDesktop.nativeRecordingRetry(${JSON.stringify(report.recoveryID)})`,
      );
      assert.equal(ready.status, "ready", ready.error ?? "retry failed");
      report.checks.recoveredOutput = await inspect(
        join(profile, "native-recordings", ready.id, "recording.mp4"),
      );
      assert.deepEqual(
        report.checks.recoveredOutput.streams.map((stream) => stream.codec),
        ["h264"],
      );
      assert.ok(report.checks.recoveredOutput.duration > 0);
      report.checks.mkvRetainedAfterRetry =
        (await stat(join(profile, "native-recordings", ready.id, "recording.mkv"))).size > 0;
      report.accepted = true;
    }
  } catch (error) {
    report.errors.push(error.stack ?? String(error));
    report.accepted = false;
  } finally {
    if (capture && capture.exitCode === null && capture.signalCode === null) {
      const closed = new Promise((done) => capture.once("close", done));
      capture.kill();
      await closed;
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ stage, ...report }) + "\n");
    app.exit(report.errors.length ? 1 : 0);
  }
}
void verify();
