import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const temp = await realpath(tmpdir());
const profile = await mkdtemp(join(temp, "sidecut-delivery-recovery-"));
const rel = relative(temp, profile);
assert.ok(rel.startsWith("sidecut-delivery-recovery-") && !rel.includes("..") && !isAbsolute(rel));
const binary = createRequire(join(root, "apps/desktop/package.json"))("electron");
const env = { ...process.env, SIDECUT_RECOVERY_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SIDECUT_RENDERER_URL;
async function run(phase) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, [join(root, "tests/desktop/verify-delivery-recovery.mjs")], {
      env: { ...env, SIDECUT_RECOVERY_PHASE: String(phase) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "",
      reason = "",
      interrupted = false;
    const stop = () => {
      if (process.platform === "win32" && child.pid) {
        const killed = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        if (killed.status !== 0) reason = "Failed to terminate the production process tree.";
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill();
        }
      }
    };
    const timer = setTimeout(() => {
      reason = "Fixture timed out after 240 seconds";
      stop();
    }, 240000);
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ])
      stream.on("data", (chunk) => {
        destination.write(chunk);
        output += chunk.toString();
        if (!interrupted && phase === 1 && output.includes("NATIVE_ENCODING_INTERRUPT_READY")) {
          interrupted = true;
          stop();
        }
        if (!interrupted && phase === 2 && output.includes("PUBLICATION_INTERRUPT_READY")) {
          interrupted = true;
          stop();
        }
        if (!reason && output.includes("Project is locked by another host")) {
          reason =
            "Production restart refused the stale project lock left by the interrupted process.";
          stop();
        }
      });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status: reason ? 1 : interrupted ? 0 : (status ?? 1), reason });
    });
  });
}
try {
  const first = await run(0);
  const second = first.status === 0 ? await run(1) : first;
  if (second.status === 0) {
    const saved = JSON.parse(await readFile(join(profile, "recovery-fixture.json"), "utf8"));
    const journal = JSON.parse(
      await readFile(
        join(profile, "delivery-journal", saved.savedNative.journal.outputID + ".json"),
        "utf8",
      ),
    );
    assert.equal(
      journal.state,
      "encoding",
      "Encoding must still be durable when the process tree has terminated",
    );
  }
  const third = second.status === 0 ? await run(2) : second;
  const result = third.status === 0 ? await run(3) : third;
  if (result.reason) {
    let report;
    try {
      report = JSON.parse(await readFile(join(profile, "recovery-fixture.json"), "utf8"));
    } catch {
      report = {
        testedAt: new Date().toISOString(),
        production: true,
        syntheticInputs: true,
        physicalCapture: false,
        checks: {
          rendering: { status: "notrun" },
          nativeEncoding: { status: "notrun" },
          publication: { status: "notrun" },
        },
        errors: [],
      };
    }
    if (report.saved) {
      report.checks.rendering = {
        status: "fail",
        interruptedDeliveryID: report.saved.entry.id,
        reason: result.reason,
      };
      delete report.saved;
    }
    report.accepted = false;
    report.errors.push({ stage: "restart", error: result.reason });
    await writeFile(
      join(root, "docs/verification/lawn-videorc-delivery-recovery.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  process.exitCode = result.status;
} finally {
  assert.equal(await realpath(profile), profile);
  assert.equal(relative(temp, profile), rel);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
