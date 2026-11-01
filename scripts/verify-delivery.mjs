import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tempRoot = await realpath(tmpdir());
const profile = await mkdtemp(join(tempRoot, "sidecut-delivery-"));
const rel = relative(tempRoot, profile);
assert.ok(rel.startsWith("sidecut-delivery-") && !rel.includes("..") && !isAbsolute(rel));
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");
const env = { ...process.env, SIDECUT_DELIVERY_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SIDECUT_RENDERER_URL;
try {
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(electron, [join(root, "tests/desktop/verify-delivery.mjs")], {
      env,
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
    }, 300000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      if (timedOut) console.error("Delivery fixture timed out after 300 seconds");
      done(timedOut ? 1 : (status ?? 1));
    });
  });
} finally {
  assert.equal(await realpath(profile), profile);
  assert.equal(relative(tempRoot, profile), rel);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
