import { app, BrowserWindow, dialog } from "electron";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = process.env.SIDECUT_RECORDING_TEST_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const result = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  production: true,
  checks: {},
  errors: [],
};
async function until(task) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const value = await task();
      if (value) return value;
    } catch {}
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("Desktop recording fixture timed out.");
}
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await until(() => BrowserWindow.getAllWindows()[0]);
    await until(() =>
      window.webContents.executeJavaScript(
        "Boolean(window.sidecutDesktop && document.querySelector('.editor-workspace'))",
      ),
    );
    const output = join(profile, "output ü");
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [output] });
    const fixture = await window.webContents.executeJavaScript(
      `(async () => {
    const bridge = window.sidecutDesktop, id = crypto.randomUUID();
    const chunk = await bridge.storagePutFile(new Uint8Array([11,22,33,44]));
    const entry = { id, projectID: "fixture", createdAt: new Date().toISOString(), type: "video/webm;codecs=vp8,opus", status: "ready", bytes: 4, chunks: [{ id: chunk, bytes: 4 }] };
    await bridge.storageRequest({ type: "commit", checks: [{ collection: "recordings", key: id, value: null }], writes: [{ collection: "recordings", key: id, value: JSON.stringify(entry) }] });
    let missingFolder = false;
    try { await bridge.recordingExport(id); } catch (error) { missingFolder = error.message.includes("Choose"); }
    await bridge.recordingDirectory();
    const saved = await bridge.recordingExport(id);
    let invalidID = false, overwrite = false;
    try { await bridge.recordingExport("../bad"); } catch { invalidID = true; }
    try { await bridge.recordingExport(id); } catch { overwrite = true; }
    return { saved, missingFolder, invalidID, overwrite, isolation: typeof process === "undefined" && typeof require === "undefined" };
  })()`,
      true,
    );
    assert.equal(fixture.missingFolder, true);
    assert.equal(fixture.invalidID, true);
    assert.equal(fixture.overwrite, true);
    assert.equal(fixture.isolation, true);
    assert.deepEqual([...(await readFile(join(output, fixture.saved.name)))], [11, 22, 33, 44]);
    assert.deepEqual(await readdir(output), [fixture.saved.name]);
    result.checks = { ...fixture, actualNamedPreloadCalls: true, outputBytesVerified: true };
    const foreign = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(root, "apps/desktop/dist/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await foreign.loadURL("data:text/html,<p>Untrusted fixture</p>");
    assert.equal(
      await foreign.webContents.executeJavaScript(
        `(async () => { try { await window.sidecutDesktop.recordingDirectory(); return false; } catch { return true; } })()`,
      ),
      true,
    );
    result.checks.untrustedOriginRejected = true;
    foreign.destroy();
    result.accepted = true;
  } catch (error) {
    result.errors.push(error.stack ?? error.message);
    result.accepted = false;
  } finally {
    await writeFile(
      join(root, "docs/verification/lawn-videorc-recording-desktop.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(result) + "\n");
    app.exit(result.accepted ? 0 : 1);
  }
}
void verify();
