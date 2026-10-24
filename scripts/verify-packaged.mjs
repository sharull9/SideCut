import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "apps/desktop/release");
const executableFlag = process.argv.indexOf("--executable");
const executable =
  executableFlag >= 0
    ? resolve(process.argv[executableFlag + 1] ?? "")
    : process.platform === "darwin"
      ? join(
          release,
          `mac${process.arch === "arm64" ? "-arm64" : ""}`,
          "SideCut.app/Contents/MacOS/SideCut",
        )
      : process.platform === "linux"
        ? join(release, `linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked`, "sidecut")
        : join(release, "win-unpacked/SideCut.exe");
const profile = await mkdtemp(join(tmpdir(), "sidecut-packaged-smoke-侧剪 "));
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
  const legacyPath = join(profile, "current.tandem");
  const legacy = JSON.stringify({
    revision: 0,
    project: {
      id: "packaged-legacy",
      name: "Legacy packaged project",
      videoTracks: [{ id: "v", kind: "video", name: "Video" }],
      audioTracks: [{ id: "a", kind: "audio", name: "Audio" }],
    },
  });
  await writeFile(legacyPath, legacy);
  const launch = (extra = []) =>
    new Promise((resolveExit, reject) => {
      const child = spawn(
        executable,
        ["--smoke-test", `--smoke-profile=${profile}`, `--smoke-output=${output}`, ...extra],
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
  await launch();
  assert.equal(
    (await readFile(join(profile, "sidecut.sqlite"))).subarray(0, 16).toString(),
    "SQLite format 3\0",
  );
  assert.equal(await readFile(legacyPath, "utf8"), legacy);
  const result = JSON.parse(await readFile(output, "utf8"));
  assert.equal(result.packaged, true);
  assert.equal(result.platform, process.platform);
  assert.equal(result.arch, process.arch);
  await launch(["--smoke-reopen"]);
  const reopened = JSON.parse(await readFile(output, "utf8"));
  assert.equal(reopened.reopened, true);
  result.reopened = true;
  result.sqlite = { format: "SQLite format 3", legacyPreserved: true, reopened: true };
  const cliScript =
    process.platform === "darwin"
      ? resolve(dirname(executable), "../Resources/cli/sidecut-cli.mjs")
      : join(dirname(executable), "resources/cli/sidecut-cli.mjs");
  const cliOutput = await new Promise((complete, reject) => {
    const child = spawn(executable, [cliScript, "--help"], {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? complete(text) : reject(new Error("Packaged CLI failed.")),
    );
  });
  assert.match(cliOutput, /Usage:/);
  result.cli = true;
  result.unicodeSpaceProfile = true;
  const evidence = join(
    release,
    `${executableFlag >= 0 ? "installed-" : ""}smoke-${process.platform}-${process.arch}.json`,
  );
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  assert.ok(profile.startsWith(join(tmpdir(), "sidecut-packaged-smoke-侧剪 ")));
  await rm(profile, { recursive: true, force: true });
}
