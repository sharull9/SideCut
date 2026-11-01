import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  profile = await mkdtemp(join(tmpdir(), "sidecut-native-recorder-"));
const binary = createRequire(join(root, "apps/desktop/package.json"))("electron");
const environment = { ...process.env, SIDECUT_NATIVE_TEST_PROFILE: profile };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.SIDECUT_RENDERER_URL;
try {
  for (const stage of ["record", "recover"]) {
    if (stage === "recover") {
      // The fixture crashed its own host. Its close event above proves the disposable lock is stale.
      assert.ok(profile.startsWith(join(tmpdir(), "sidecut-native-recorder-")));
      await rm(join(profile, "current.tandem.lock"), { force: true });
    }
    const code = await new Promise((done, reject) => {
      const child = spawn(binary, [join(root, "tests/desktop/verify-native-recorder.mjs")], {
        env: { ...environment, SIDECUT_NATIVE_TEST_STAGE: stage },
        windowsHide: true,
        stdio: "inherit",
      });
      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid)
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        else child.kill();
      }, 60000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timer);
        done(exitCode ?? 1);
      });
    });
    if (code) {
      process.exitCode = code;
      break;
    }
  }
} finally {
  assert.ok(profile.startsWith(join(tmpdir(), "sidecut-native-recorder-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
