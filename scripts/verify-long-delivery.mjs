import { spawn } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const temp = await realpath(tmpdir());
const profile = await mkdtemp(join(temp, "sidecut-long-delivery-"));
const rel = relative(temp, profile);
assert.ok(rel.startsWith("sidecut-long-delivery-") && !rel.includes("..") && !isAbsolute(rel));
const binary = createRequire(join(root, "apps/desktop/package.json"))("electron");
const env = { ...process.env, SIDECUT_LONG_DELIVERY_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SIDECUT_RENDERER_URL;
try {
  const code = await new Promise((done, reject) => {
    const child = spawn(binary, [join(root, "tests/desktop/verify-long-delivery.mjs")], {
      env,
      windowsHide: true,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (status) => done(status ?? 1));
  });
  process.exitCode = code;
} finally {
  assert.equal(await realpath(profile), profile);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
