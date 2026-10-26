import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  nativeImage,
  session,
  systemPreferences,
} from "electron";
import { writeFile } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = process.env.SIDECUT_RECORDING_TEST_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
delete process.env.SIDECUT_RENDERER_URL;
const result = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  production: true,
  syntheticDevices: true,
  simulatedPicker: true,
  osPermissionStatus: "simulated granted, with denied exercised separately",
  limitations: [
    "Picker and source enumeration are simulated; no desktop pixels are captured.",
    "Synthetic video MediaRecorder.start previously threw NotSupportedError in this environment; video output is not verified.",
  ],
  checks: {},
  errors: [],
};
async function until(task) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await task().catch(() => false);
    if (value) return value;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("Capture verification timed out.");
}
async function verify() {
  try {
    let displayHandler;
    const intercepted = app.whenReady().then(() => {
      const setDisplay = session.defaultSession.setDisplayMediaRequestHandler.bind(
        session.defaultSession,
      );
      session.defaultSession.setDisplayMediaRequestHandler = (handler, options) => {
        displayHandler = handler;
        setDisplay(handler, options);
      };
    });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    // No physical camera, microphone or desktop pixels are captured by this fixture.
    systemPreferences.getMediaAccessStatus = () => "granted";
    await import("../../apps/desktop/dist/main.mjs");
    await intercepted;
    const window = await until(async () => BrowserWindow.getAllWindows()[0]);
    window.webContents.setBackgroundThrottling(false);
    const evaluate = (script) => window.webContents.executeJavaScript(script, true);
    await until(() =>
      evaluate("Boolean(window.sidecutDesktop && document.querySelector('.editor-workspace'))"),
    );
    const media = await evaluate(`(async () => {
      const host = window.sidecutDesktop;
      const denied = async (constraints) => { try { const stream = await navigator.mediaDevices.getUserMedia(constraints); stream.getTracks().forEach(track => track.stop()); return false; } catch { return true; } };
      const outside = await denied({audio:true});
      const id = crypto.randomUUID();
      await host.capturePrepare(id, {source:"microphone", microphone:false});
      let duplicate = false; try { await host.capturePrepare(crypto.randomUUID(), {source:"camera",microphone:false}); } catch { duplicate = true; }
      const audio = await navigator.mediaDevices.getUserMedia({audio:true});
      const audioLive = audio.getAudioTracks().length === 1;
      audio.getTracks().forEach(track => track.stop());
      const cameraDenied = await denied({video:true});
      await host.captureRelease(crypto.randomUUID());
      const stillAllowed = !(await denied({audio:true}));
      await host.captureRelease(id);
      const released = await denied({audio:true});
      return {outside, duplicate, audioLive, cameraDenied, stillAllowed, released};
    })()`);
    for (const key of [
      "outside",
      "duplicate",
      "audioLive",
      "cameraDenied",
      "stillAllowed",
      "released",
    ])
      assert.equal(media[key], true, key);
    result.checks.mediaPermissionPipeline = media;

    let answer;
    dialog.showMessageBox = () =>
      new Promise((done) => {
        answer = done;
      });
    await evaluate(
      `window.captureID = crypto.randomUUID(); window.pendingCapture = window.sidecutDesktop.capturePrepare(window.captureID, {source:"camera",microphone:false}).then(() => false, () => true); true`,
    );
    await until(async () => Boolean(answer));
    await evaluate("window.sidecutDesktop.captureRelease(window.captureID)");
    answer({ response: 1, checkboxChecked: false });
    assert.equal(await evaluate("window.pendingCapture"), true);
    result.checks.cancelledApprovalRejected = true;
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });

    const source = {
      id: "screen:fixture:0",
      name: "Synthetic screen",
      display_id: "fixture",
      thumbnail: nativeImage.createEmpty(),
      appIcon: null,
    };
    let available = true;
    desktopCapturer.getSources = async () => (available ? [source] : []);
    const display = (overrides = {}) =>
      new Promise((done) =>
        displayHandler(
          {
            frame: window.webContents.mainFrame,
            securityOrigin: "sidecut://app",
            videoRequested: true,
            audioRequested: false,
            userGesture: true,
            ...overrides,
          },
          done,
        ),
      );
    assert.deepEqual(await display(), {});
    await evaluate(
      `window.captureID = crypto.randomUUID(); window.sidecutDesktop.capturePrepare(window.captureID, {source:"screen",microphone:false})`,
    );
    assert.deepEqual(await display({ securityOrigin: "https://untrusted.example" }), {});
    assert.deepEqual(await display({ frame: null }), {});
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    assert.deepEqual(await display(), {});
    result.checks.untrustedDisplayRejected = true;
    result.checks.cancelledPickerRejected = true;
    await evaluate("window.sidecutDesktop.captureRelease(window.captureID)");
    await evaluate(
      `window.captureID = crypto.randomUUID(); window.sidecutDesktop.capturePrepare(window.captureID, {source:"screen",microphone:false})`,
    );
    dialog.showMessageBox = () =>
      new Promise((done) => {
        answer = done;
      });
    answer = undefined;
    const pendingDisplay = display();
    await until(async () => Boolean(answer));
    await evaluate("window.sidecutDesktop.captureRelease(window.captureID)");
    answer({ response: 1, checkboxChecked: false });
    assert.deepEqual(await pendingDisplay, {});
    result.checks.stalePickerRejected = true;
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    await evaluate(
      `window.captureID = crypto.randomUUID(); window.sidecutDesktop.capturePrepare(window.captureID, {source:"screen",microphone:true})`,
    );
    dialog.showMessageBox = async () => {
      available = false;
      return { response: 1, checkboxChecked: false };
    };
    assert.deepEqual(await display(), {});
    await evaluate("window.sidecutDesktop.captureRelease(window.captureID)");
    available = true;
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    await evaluate(
      `window.captureID = crypto.randomUUID(); window.sidecutDesktop.capturePrepare(window.captureID, {source:"screen",microphone:false})`,
    );
    assert.equal((await display()).video.id, source.id);
    assert.deepEqual(await display(), {});
    await evaluate("window.sidecutDesktop.captureRelease(window.captureID)");
    result.checks.removedSourceRejected = true;
    result.checks.selectedSourceOnlyOnce = true;
    await evaluate(
      `window.sidecutDesktop.capturePrepare(crypto.randomUUID(), {source:"microphone",microphone:false})`,
    );
    await window.webContents.reload();
    await until(() =>
      evaluate("Boolean(window.sidecutDesktop && document.querySelector('.editor-workspace'))"),
    );
    assert.equal(
      await evaluate(
        `navigator.mediaDevices.getUserMedia({audio:true}).then(stream => { stream.getTracks().forEach(track => track.stop()); return false; }, () => true)`,
      ),
      true,
    );
    result.checks.navigationRevokes = true;
    const foreign = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(root, "apps/desktop/dist/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await foreign.loadURL("data:text/html,untrusted");
    await evaluate(
      `window.captureID = crypto.randomUUID(); window.sidecutDesktop.capturePrepare(window.captureID, {source:"screen",microphone:false})`,
    );
    assert.deepEqual(
      await display({ frame: foreign.webContents.mainFrame, securityOrigin: "data://" }),
      {},
    );
    await evaluate("window.sidecutDesktop.captureRelease(window.captureID)");
    assert.equal(
      await foreign.webContents.executeJavaScript(
        `window.sidecutDesktop.capturePrepare("00000000-0000-4000-8000-000000000000",{source:"camera",microphone:false}).then(() => false, () => true)`,
      ),
      true,
    );
    foreign.destroy();
    result.checks.foreignSenderRejected = true;
    if (["win32", "darwin"].includes(process.platform)) {
      systemPreferences.getMediaAccessStatus = () => "denied";
      assert.equal(
        await evaluate(
          `window.sidecutDesktop.capturePrepare(crypto.randomUUID(),{source:"camera",microphone:false}).then(() => false, () => true)`,
        ),
        true,
      );
      result.checks.osDeniedRejected = true;
      systemPreferences.getMediaAccessStatus = () => "granted";
    } else {
      result.checks.osDeniedRejected = "not applicable on this platform";
    }
    await evaluate(
      `(() => { const select = document.querySelector('#recording-source'); select.value = 'microphone'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Start recording').click()`,
    );
    await until(() =>
      evaluate(
        `Boolean([...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Stop recording') || document.querySelector('[role="alert"]'))`,
      ),
    );
    const startError = await evaluate(
      `document.querySelector('[role="alert"]')?.textContent ?? null`,
    );
    assert.equal(startError, null, `Recording failed to start: ${startError}`);
    await new Promise((done) => setTimeout(done, 3000));
    await evaluate(
      `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Stop recording').click()`,
    );
    await until(() =>
      evaluate(
        `Boolean(document.querySelector('a[download]') || document.querySelector('[role="alert"]'))`,
      ),
    );
    const recording = await evaluate(
      `(async () => { const link = document.querySelector('a[download]'); return link ? {name:link.download, bytes:(await (await fetch(link.href)).blob()).size} : {error:document.querySelector('[role="alert"]')?.textContent}; })()`,
    );
    result.checks.appMicrophoneRecording = recording;
    assert.ok(recording.bytes > 0, JSON.stringify(recording));
    const stored = await evaluate(
      `window.sidecutDesktop.storageRequest({type:"read",collection:"recordings"})`,
    );
    assert.equal(stored.length, 1);
    assert.equal(JSON.parse(stored[0].value).bytes, recording.bytes);
    const acceptUnload = (event) => event.preventDefault();
    window.webContents.once("will-prevent-unload", acceptUnload);
    const reloaded = new Promise((done) => window.webContents.once("did-finish-load", done));
    window.webContents.reload();
    await reloaded;
    window.webContents.removeListener("will-prevent-unload", acceptUnload);
    await until(() =>
      evaluate(
        `Boolean([...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Refresh saved recordings'))`,
      ),
    );
    const recovered = await evaluate(
      `window.sidecutDesktop.storageRequest({type:"read",collection:"recordings"})`,
    );
    assert.deepEqual(recovered, stored);
    result.checks.recordingMetadataUnchanged = true;
    const recoveredBytes = await evaluate(`(async () => {
      const rows = await window.sidecutDesktop.storageRequest({type:"read",collection:"recordings"});
      const entry = JSON.parse(rows[0].value);
      const parts = await Promise.all(entry.chunks.map(chunk => window.sidecutDesktop.storageGetFile(chunk.id)));
      return (await new Blob(parts).arrayBuffer()).byteLength;
    })()`);
    assert.equal(recoveredBytes, recording.bytes);
    result.checks.recoveredChunkBytes = recoveredBytes;
    await evaluate(
      `[...document.querySelectorAll('details')].find(section => section.querySelector('summary')?.textContent.includes('Saved recordings')).open = true`,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Refresh saved recordings').click()`,
    );
    try {
      await until(() =>
        evaluate(`Boolean(document.querySelector('[data-testid="saved-recording"]'))`),
      );
    } catch (error) {
      result.checks.recordingSurvivesReload = false;
      result.checks.savedRecordingsDiagnostic = await evaluate(
        `document.body.innerText.slice(0, 5000)`,
      );
      throw error;
    }
    assert.match(
      await evaluate(`document.querySelector('[data-testid="saved-recording"]').textContent`),
      /Ready/,
    );
    result.checks.recordingSurvivesReload = true;
    result.accepted = true;
  } catch (error) {
    result.errors.push(error?.stack ?? error?.message ?? String(error));
    result.accepted = false;
  } finally {
    await writeFile(
      join(root, "docs/verification/lawn-videorc-native-permissions.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(result) + "\n");
    app.exit(result.accepted ? 0 : 1);
  }
}
void verify();
