import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const durationSeconds = Number.parseInt(process.env.SIDECUT_LONG_RUN_SECONDS ?? "3600", 10);
assert.ok(Number.isSafeInteger(durationSeconds) && durationSeconds >= 60);
// Inputs can buffer ahead, so a media-time cutoff alone cannot guarantee elapsed wall time.
const targetMediaSeconds = durationSeconds + 5;
const reportPath = join(
  root,
  "docs",
  "verification",
  durationSeconds >= 3600 ? "lawn-videorc-long-run.json" : "lawn-videorc-long-run-development.json",
);
const require = createRequire(join(root, "apps", "desktop", "package.json"));
const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;
const exec = promisify(execFile);
const runRoot = await mkdtemp(join(tmpdir(), "sidecut-native-long-run-"));
const output = join(runRoot, "recording.mkv");
const remuxed = join(runRoot, "recording.mp4");
const startedAt = new Date().toISOString();
const report = {
  testedAt: startedAt,
  platform: process.platform,
  production: false,
  syntheticInputs: true,
  profile: "real-time lavfi tone first + 1080p30 test pattern",
  requestedWallSeconds: durationSeconds,
  targetMediaSeconds,
  status: "running",
  accepted: false,
  samples: [],
  checks: {},
  errors: [],
  limits: [
    "Synthetic inputs do not establish physical-device cadence, device loss, or calibrated A/V sync.",
    "This direct FFmpeg run uses NativeRecorder's codec, queue, muxer and flush settings. It does not exercise Electron IPC or the recorder journal.",
  ],
};

async function save() {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function processMetrics(pid) {
  if (process.platform !== "win32") return { pid };
  try {
    const { stdout } = await exec(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-Process -Id ${pid} | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
      ],
      { timeout: 10000, windowsHide: true },
    );
    const value = JSON.parse(stdout);
    return {
      pid: value.Id,
      cpuSeconds: value.CPU ?? null,
      workingSetBytes: value.WorkingSet64 ?? null,
      privateBytes: value.PrivateMemorySize64 ?? null,
    };
  } catch {
    return { pid, unavailable: true };
  }
}

function start(command, args, timeoutMs) {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  const deadline = setTimeout(() => child.kill(), timeoutMs);
  const done = new Promise((complete, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => complete({ code, signal, stderr }));
  }).finally(() => clearTimeout(deadline));
  return { child, done };
}

async function inspect(path) {
  const { stdout } = await exec(
    ffprobe,
    [
      "-v",
      "error",
      "-count_packets",
      "-show_entries",
      "format=duration,size,start_time:stream=index,codec_type,codec_name,width,height,avg_frame_rate,start_time,duration,nb_read_packets",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 120000 },
  );
  return JSON.parse(stdout);
}

const args = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-progress",
  "pipe:1",
  "-stats_period",
  "1",
  "-re",
  "-thread_queue_size",
  "32",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000",
  "-re",
  "-thread_queue_size",
  "4",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=1920x1080:rate=30",
  "-map",
  "1:v:0",
  "-map",
  "0:a:0",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "60",
  "-preset",
  "veryfast",
  "-crf",
  "23",
  "-threads",
  "2",
  "-c:a",
  "aac",
  "-cluster_time_limit",
  "1000",
  "-flush_packets",
  "1",
  "-t",
  String(targetMediaSeconds),
  "-n",
  output,
];

let child;
let sampleTimer;
let pendingSample = Promise.resolve();
let progressSeconds = 0;
let interrupted = null;
const wallStarted = performance.now();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = signal;
    if (child && child.exitCode === null) child.kill();
  });
}
try {
  await save();
  const capture = start(
    ffmpeg,
    args,
    (durationSeconds + Math.max(120, durationSeconds * 0.05)) * 1000,
  );
  child = capture.child;
  report.encoderPid = child.pid;
  let progressBuffer = "";
  child.stdout.on("data", (chunk) => {
    progressBuffer += chunk.toString();
    const lines = progressBuffer.split("\n");
    progressBuffer = lines.pop().slice(-1024);
    for (const line of lines) {
      const match = /^out_time_us=(\d+)$/.exec(line.trim());
      if (match) progressSeconds = Number(match[1]) / 1_000_000;
    }
  });
  const sample = async () => {
    const details = await stat(output).catch(() => null);
    const memory = process.memoryUsage();
    report.samples.push({
      wallSeconds: Number(((performance.now() - wallStarted) / 1000).toFixed(3)),
      encodedSeconds: Number(progressSeconds.toFixed(3)),
      diskBytes: details?.size ?? 0,
      encoder: await processMetrics(child.pid),
      node: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
    });
    await save();
  };
  await sample();
  sampleTimer = setInterval(() => {
    pendingSample = pendingSample.then(sample).catch((error) => {
      report.errors.push(`Sample failed: ${error.message}`);
      child.kill();
    });
  }, 60000);
  const status = await capture.done;
  const captureWallSeconds = (performance.now() - wallStarted) / 1000;
  report.captureWallSeconds = captureWallSeconds;
  report.captureExit = status;
  clearInterval(sampleTimer);
  await pendingSample;
  if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
  assert.equal(
    status.code,
    0,
    `Capture failed (${status.signal ?? status.code}): ${status.stderr}`,
  );
  assert.equal(report.errors.length, 0, "Sampling failed");
  report.status = "remuxing";
  report.captureWallSeconds = captureWallSeconds;
  await save();
  const remux = start(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      output,
      "-map",
      "0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-n",
      remuxed,
    ],
    120000,
  );
  child = remux.child;
  child.stdout.resume();
  const remuxStatus = await remux.done;
  if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
  assert.equal(
    remuxStatus.code,
    0,
    `Remux failed (${remuxStatus.signal ?? remuxStatus.code}): ${remuxStatus.stderr}`,
  );
  const media = await inspect(remuxed);
  report.probe = media;
  await save();
  const streams = media.streams.filter((stream) => ["video", "audio"].includes(stream.codec_type));
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  assert.equal(video?.codec_name, "h264");
  assert.equal(audio?.codec_name, "aac");
  assert.equal(video?.width, 1920);
  assert.equal(video?.height, 1080);
  assert.ok(Number(video?.nb_read_packets) >= durationSeconds * 29);
  assert.ok(Number(audio?.nb_read_packets) > durationSeconds * 40);
  const mediaDuration = Number(media.format.duration);
  const timestampDriftSeconds = Math.abs(mediaDuration - targetMediaSeconds);
  assert.ok(timestampDriftSeconds <= Math.max(3, durationSeconds * 0.002));
  const avStartDifferenceSeconds = Math.abs(Number(video.start_time) - Number(audio.start_time));
  const avEndDifferenceSeconds = Math.abs(
    Number(video.start_time) +
      Number(video.duration) -
      Number(audio.start_time) -
      Number(audio.duration),
  );
  assert.ok(Number.isFinite(avStartDifferenceSeconds) && avStartDifferenceSeconds <= 0.25);
  assert.ok(Number.isFinite(avEndDifferenceSeconds) && avEndDifferenceSeconds <= 0.25);
  report.checks = {
    captureWallSeconds,
    mediaDuration,
    timestampDriftSeconds,
    realtimeDriftSeconds: Math.abs(captureWallSeconds - targetMediaSeconds),
    avStartDifferenceSeconds,
    avEndDifferenceSeconds,
    sizeBytes: Number(media.format.size),
    streams,
    sampleCount: report.samples.length,
    maxEncoderWorkingSetBytes: Math.max(
      ...report.samples.map((s) => s.encoder.workingSetBytes ?? 0),
    ),
    maxEncoderPrivateBytes: Math.max(...report.samples.map((s) => s.encoder.privateBytes ?? 0)),
    maxNodeRssBytes: Math.max(...report.samples.map((s) => s.node.rssBytes)),
    maxNodeHeapUsedBytes: Math.max(...report.samples.map((s) => s.node.heapUsedBytes)),
  };
  assert.ok(
    captureWallSeconds >= durationSeconds,
    `Capture ended after ${captureWallSeconds} seconds, before the ${durationSeconds}-second wall minimum`,
  );
  assert.ok(
    Math.abs(captureWallSeconds - targetMediaSeconds) <= Math.max(15, durationSeconds * 0.01),
  );
  report.qualifiesForHourAcceptance = durationSeconds >= 3600 && captureWallSeconds >= 3600;
  report.status = "completed";
  report.accepted = true;
} catch (error) {
  if (sampleTimer) clearInterval(sampleTimer);
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  await pendingSample;
  report.status = interrupted ? "interrupted" : "failed";
  report.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await save();
  assert.ok(runRoot.startsWith(join(tmpdir(), "sidecut-native-long-run-")));
  await rm(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = report.accepted ? 0 : 1;
