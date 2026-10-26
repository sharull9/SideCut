import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
const ffmpeg = requireDesktop("ffmpeg-static"),
  ffprobe = requireDesktop("ffprobe-static").path;
async function execute(binary, args, timeout = 25000) {
  const start = performance.now();
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    const disconnect = () => child.kill();
    process.once("disconnect", disconnect);
    child.stdout.on("data", (bytes) => {
      stdout = (stdout + bytes).slice(-2000000);
    });
    child.stderr.on("data", (bytes) => {
      stderr = (stderr + bytes).slice(-20000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      process.removeListener("disconnect", disconnect);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      process.removeListener("disconnect", disconnect);
      resolveResult({ code, timedOut, elapsedMs: performance.now() - start, stdout, stderr });
    });
  });
}
async function synthetic(output) {
  return execute(ffmpeg, [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000",
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-y",
    output,
  ]);
}
if (process.argv.includes("--worker")) {
  const folder = await mkdtemp(join(tmpdir(), "sidecut-capture-worker-"));
  try {
    const value = await synthetic(join(folder, "synthetic.mkv"));
    process.stdout.write(
      JSON.stringify({ code: value.code, elapsedMs: value.elapsedMs, timedOut: value.timedOut }),
    );
  } finally {
    assert.ok(folder.startsWith(join(tmpdir(), "sidecut-capture-worker-")));
    await rm(folder, { recursive: true, force: true });
  }
} else {
  const directory = await mkdtemp(join(tmpdir(), "sidecut-capture-probe-"));
  const result = {
    testedAt: new Date().toISOString(),
    platform: process.platform,
    profiles: [],
    errors: [],
    physicalAVSyncMeasured: false,
  };
  const inspect = async (path, run, name, expectedAudio) => {
    if (run.code !== 0 || run.timedOut) {
      const value = {
        name,
        accepted: false,
        reason: run.timedOut
          ? "Capture timed out"
          : run.stderr.replaceAll(directory, "<temporary>").slice(-1500),
      };
      result.profiles.push(value);
      return;
    }
    const probe = await execute(ffprobe, [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ]);
    if (probe.code !== 0) throw new Error("Could not inspect the captured fixture.");
    const metadata = JSON.parse(probe.stdout),
      video = metadata.streams.find((stream) => stream.codec_type === "video"),
      audio = metadata.streams.find((stream) => stream.codec_type === "audio");
    const frames = Number(video?.nb_read_frames),
      seconds = Number(metadata.format.duration);
    const timestamps = await execute(ffprobe, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "frame=best_effort_timestamp_time",
      "-of",
      "csv=p=0",
      path,
    ]);
    const times = timestamps.stdout
      .split(/\r?\n/)
      .map((line) => Number.parseFloat(line))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const steps = times
      .slice(1)
      .map((value, index) => value - times[index])
      .sort((a, b) => a - b);
    result.profiles.push({
      name,
      accepted: Boolean(
        video &&
        video.width === 1920 &&
        video.height === 1080 &&
        frames >= 140 &&
        (!expectedAudio || audio),
      ),
      elapsedMs: run.elapsedMs,
      frames,
      duration: seconds,
      effectiveEncodeFps: frames / (run.elapsedMs / 1000),
      video: video
        ? {
            codec: video.codec_name,
            width: video.width,
            height: video.height,
            fps: video.avg_frame_rate,
            start: video.start_time,
          }
        : null,
      audio: audio
        ? { codec: audio.codec_name, start: audio.start_time, sampleRate: audio.sample_rate }
        : null,
      medianFrameStepMs: steps.length ? steps[Math.floor(steps.length / 2)] * 1000 : null,
      p95FrameStepMs: steps.length ? steps[Math.floor(steps.length * 0.95)] * 1000 : null,
      maxFrameStepMs: steps.length ? steps.at(-1) * 1000 : null,
      initialTimestampSkewMs:
        video && audio
          ? Math.abs(Number(video.start_time) - Number(audio.start_time)) * 1000
          : null,
    });
  };
  try {
    const syntheticPath = join(directory, "host.mkv");
    await inspect(
      syntheticPath,
      await synthetic(syntheticPath),
      "host-managed synthetic 1080p30 + tone",
      true,
    );
    const worker = await execute(process.execPath, [import.meta.filename, "--worker"]);
    result.worker =
      worker.code === 0
        ? {
            ...JSON.parse(worker.stdout),
            totalElapsedMs: worker.elapsedMs,
            implementation: "Private Node process supervising the same FFmpeg encoder",
          }
        : { code: worker.code, reason: "Private worker failed" };
    if (process.platform === "win32") {
      const devices = await execute(
        ffmpeg,
        ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
        10000,
      );
      const audioDevices = [...devices.stderr.matchAll(/"([^"\r\n]+)" \(audio\)/g)].map(
        (match) => match[1],
      );
      result.microphoneDeviceCount = audioDevices.length;
      if (process.argv.includes("--screen")) {
        const output = join(directory, "screen.mkv");
        const run = await execute(ffmpeg, [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-f",
          "gdigrab",
          "-framerate",
          "30",
          "-video_size",
          "1920x1080",
          "-i",
          "desktop",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=880:sample_rate=48000",
          "-t",
          "5",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "aac",
          "-y",
          output,
        ]);
        await inspect(output, run, "Windows desktop + synthetic audio", true);
      }
      if (process.argv.includes("--microphone") && audioDevices.length) {
        const output = join(directory, "microphone.mkv");
        const run = await execute(ffmpeg, [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-f",
          "gdigrab",
          "-framerate",
          "30",
          "-video_size",
          "1920x1080",
          "-i",
          "desktop",
          "-f",
          "dshow",
          "-i",
          `audio=${audioDevices[0]}`,
          "-t",
          "5",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "aac",
          "-y",
          output,
        ]);
        // Device identifiers and captured audio/pictures never enter retained evidence.
        if (run.code !== 0)
          run.stderr = "Native microphone capture failed; device details omitted.";
        await inspect(output, run, "Windows desktop + microphone", true);
        const queuedOutput = join(directory, "queued-microphone.mkv");
        const queued = await execute(ffmpeg, [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-thread_queue_size",
          "512",
          "-f",
          "dshow",
          "-audio_buffer_size",
          "50",
          "-rtbufsize",
          "128M",
          "-i",
          `audio=${audioDevices[0]}`,
          "-thread_queue_size",
          "512",
          "-f",
          "gdigrab",
          "-framerate",
          "30",
          "-video_size",
          "1920x1080",
          "-i",
          "desktop",
          "-map",
          "1:v:0",
          "-map",
          "0:a:0",
          "-t",
          "5",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "aac",
          "-y",
          queuedOutput,
        ]);
        if (queued.code !== 0)
          queued.stderr = "Queued native microphone capture failed; device details omitted.";
        await inspect(
          queuedOutput,
          queued,
          "Windows microphone-first + bounded input queues",
          true,
        );
      } else
        result.physicalMicrophone =
          "Not measured: no enumerated input device or --microphone not selected";
    }
    result.engineDecision =
      "Keep supervised FFmpeg as the initial encoding candidate. Gate native capture on microphone startup/cadence and physical A/V calibration; a private Node wrapper alone does not solve device timing. No Rust/GPU choice is justified by this probe.";
    result.limits = [
      "Five-second samples, no sustained recording or physical A/V calibration",
      "Frame cadence and container start timestamps are not physical sync measurements",
      "Node worker comparison uses the same software encoder; no Rust or GPU prototype was measured",
      "No capture artifacts or device names retained",
    ];
  } catch (error) {
    result.errors.push(error.message);
    process.exitCode = 1;
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "sidecut-capture-probe-")));
    await rm(directory, { recursive: true, force: true });
    await writeFile(
      join(root, "docs/verification/lawn-videorc-native-probe.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(result) + "\n");
  }
}
