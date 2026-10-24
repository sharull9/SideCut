import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, readFile, writeFile, rm, chmod, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps/desktop");
const require = createRequire(join(desktop, "package.json"));
const { build, Platform, Arch } = require("electron-builder");
const manifest = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"));
const stage = join(desktop, ".package");
assert.equal(dirname(stage), desktop);
const version =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME?.replace(/^v/, "")
    : manifest.version;
assert.match(
  version ?? "",
  /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/,
  "Use a version tag such as v0.1.0.",
);
assert.ok(
  ["x64", "arm64"].includes(process.arch),
  "Only native x64 and arm64 packaging is supported.",
);
assert.ok(
  process.argv.slice(2).every((argument) => argument === "--dir"),
  "Only --dir is supported; cross-compiling native binaries is intentionally disabled.",
);
assert.ok(
  process.platform !== "win32" || process.argv.includes("--dir"),
  "Windows verification supports --dir only; installer targets are Linux and macOS.",
);

const binaries = { ffmpeg: require("ffmpeg-static"), ffprobe: require("ffprobe-static").path };
for (const [name, binary] of Object.entries(binaries)) {
  assert.ok(binary, `${name} is unavailable for this platform.`);
  await access(binary);
  const result = spawnSync(binary, ["-version"], { windowsHide: true, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${name} cannot run on this architecture: ${result.error ?? result.stderr}`,
  );
}
await access(join(desktop, "dist/main.mjs"));
await access(join(root, "apps/web/.output/public/_shell.html"));
await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "resources/media"), { recursive: true });
await cp(join(desktop, "dist"), join(stage, "dist"), { recursive: true });
await cp(join(root, "apps/web/.output/public"), join(stage, "resources/renderer"), {
  recursive: true,
});
await writeFile(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "sidecut",
      version,
      productName: "SideCut",
      description: "Local video editor",
      homepage: "https://github.com/sharull9/SideCut",
      author: "SideCut contributors",
      type: "module",
      main: "dist/main.mjs",
    },
    null,
    2,
  ) + "\n",
);
const notices = join(stage, "resources/licenses");
await mkdir(notices, { recursive: true });
for (const [name, binary] of Object.entries(binaries)) {
  const destination = join(
    stage,
    "resources/media",
    `${name}${process.platform === "win32" ? ".exe" : ""}`,
  );
  await cp(binary, destination);
  await chmod(destination, 0o755);
  const packageRoot = dirname(require.resolve(`${name}-static/package.json`));
  await cp(join(packageRoot, "LICENSE"), join(notices, `${name}-static-LICENSE`));
  await cp(join(packageRoot, "README.md"), join(notices, `${name}-static-README.md`));
}
// The FFmpeg installer downloads build-specific notices alongside its executable.
for (const extension of ["LICENSE", "README"])
  await cp(`${binaries.ffmpeg}.${extension}`, join(notices, `ffmpeg-binary-${extension}`));
await cp(join(root, "tests/fixtures/tandem/TANDEM-LICENSE"), join(notices, "TANDEM-LICENSE"));
await writeFile(
  join(notices, "SOURCES.txt"),
  "FFmpeg binary and source provenance: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1\nFFmpeg installer: https://github.com/eugeneware/ffmpeg-static\nFFprobe binaries and build provenance: https://github.com/derhuerst/ffprobe-static\n",
);

const platform =
  process.platform === "darwin"
    ? Platform.MAC
    : process.platform === "linux"
      ? Platform.LINUX
      : Platform.WINDOWS;
const arch = process.arch === "arm64" ? Arch.arm64 : Arch.x64;
await build({
  projectDir: desktop,
  config: {
    ...require(join(desktop, "electron-builder.config.cjs")),
    electronVersion: require("electron/package.json").version,
  },
  targets: platform.createTarget(process.argv.includes("--dir") ? ["dir"] : undefined, arch),
  publish: "never",
});
