import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "apps/desktop/release");
const executable =
  process.platform === "darwin"
    ? join(
        release,
        `mac${process.arch === "arm64" ? "-arm64" : ""}`,
        "SideCut.app/Contents/MacOS/SideCut",
      )
    : process.platform === "linux"
      ? join(release, `linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked`, "sidecut")
      : join(release, "win-unpacked/SideCut.exe");
const profile = await mkdtemp(join(tmpdir(), "sidecut-packaged-smoke-"));
const output = join(profile, "result.json");
const env = { ...process.env };
for (const name of [
  "ELECTRON_RUN_AS_NODE",
  "SIDECUT_RENDERER_URL",
  "SIDECUT_FFMPEG",
  "SIDECUT_FFPROBE",
  "FFMPEG_BIN",
])
  delete env[name];
try {
  await new Promise((resolveExit, reject) => {
    const child = spawn(
      executable,
      ["--smoke-test", `--smoke-profile=${profile}`, `--smoke-output=${output}`],
      { env, stdio: "inherit", windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 120_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveExit();
      else reject(new Error(`Packaged app failed (${code ?? signal}).`));
    });
  });
  const result = JSON.parse(await readFile(output, "utf8"));
  assert.equal(result.packaged, true);
  assert.equal(result.platform, process.platform);
  assert.equal(result.arch, process.arch);
  const evidence = join(release, `smoke-${process.platform}-${process.arch}.json`);
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  assert.ok(profile.startsWith(join(tmpdir(), "sidecut-packaged-smoke-")));
  await rm(profile, { recursive: true, force: true });
}
