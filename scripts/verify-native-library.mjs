import { spawn } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const tempRoot = await realpath(tmpdir());
const profile = await mkdtemp(join(tempRoot, "sidecut-native-library-"));
const relativeProfile = relative(tempRoot, profile);
assert.ok(
  relativeProfile.startsWith("sidecut-native-library-") &&
    !relativeProfile.includes("..") &&
    !isAbsolute(relativeProfile),
);
const binary = createRequire(join(root, "apps/desktop/package.json"))("electron");
const environment = { ...process.env, SIDECUT_NATIVE_LIBRARY_PROFILE: profile };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.SIDECUT_RENDERER_URL;
try {
  const code = await new Promise((done, reject) => {
    const child = spawn(binary, [join(root, "tests/desktop/verify-native-library.mjs")], {
      env: environment,
      windowsHide: true,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill());
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill();
        }
      }
    }, 120000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      if (timedOut) console.error("Native library fixture timed out after 120 seconds");
      done(timedOut ? 1 : (status ?? 1));
    });
  });
  process.exitCode = code;
} finally {
  assert.equal(await realpath(profile), profile);
  assert.ok(relative(tempRoot, profile) === relativeProfile);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
