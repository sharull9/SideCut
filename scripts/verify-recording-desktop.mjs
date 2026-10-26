import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  profile = await mkdtemp(join(tmpdir(), "sidecut-recording-desktop-"));
const binary = createRequire(join(root, "apps/desktop/package.json"))("electron");
await mkdir(join(profile, "output ü"));
const environment = { ...process.env, SIDECUT_RECORDING_TEST_PROFILE: profile };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.SIDECUT_RENDERER_URL;
try {
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(binary, [join(root, "tests/desktop/verify-recording-storage.mjs")], {
      env: environment,
      windowsHide: true,
      stdio: "inherit",
    });
    const timer = setTimeout(() => child.kill(), 60000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      done(code ?? 1);
    });
  });
} finally {
  assert.ok(profile.startsWith(join(tmpdir(), "sidecut-recording-desktop-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
