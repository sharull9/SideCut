import assert from "node:assert/strict";
import { app } from "electron";
import type { BrowserWindow } from "electron";
import type { ProviderCredentials } from "./provider-credentials.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NativeProjectStore } from "./project-store.ts";

// Invoked only by the explicit --smoke-test command in a disposable profile.
export async function verifyPackaged(window: BrowserWindow, credentials: ProviderCredentials) {
  assert.equal(app.isPackaged, true);
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const wait = async (source: string) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await evaluate(source).catch(() => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const alerts = await evaluate(
      `Array.from(document.querySelectorAll('[role="alert"]')).map(e => e.textContent)`,
    );
    throw new Error(`Packaged smoke test timed out: ${source}. Alerts: ${JSON.stringify(alerts)}`);
  };
  await wait(
    `Boolean(window.sidecutDesktop && document.querySelector('[data-testid="project-name"]') && document.querySelector('button[aria-label="Import media"]')?.disabled === false)`,
  );
  const isolation = await evaluate(
    `({ node: typeof process, require: typeof require, bridge: typeof window.sidecutDesktop.projectRequest })`,
  );
  assert.equal(isolation.node, "undefined");
  assert.equal(isolation.require, "undefined");
  assert.equal(isolation.bridge, "function");
  if (app.commandLine.hasSwitch("smoke-reopen")) {
    const reopened = await evaluate(
      `JSON.parse(window.sidecutDesktop.projectRequest('{"type":"snapshot"}').snapshot.json)`,
    );
    assert.equal(reopened.project.name, "Packaged smoke fixture");
    assert.equal(reopened.project.media.length, 1);
    assert.equal(reopened.project.audioTracks[0].clips.length, 1);
    return {
      packaged: true,
      platform: process.platform,
      arch: process.arch,
      reopened: true,
      revision: reopened.revision,
    };
  }
  const migrated = await evaluate(
    `JSON.parse(window.sidecutDesktop.projectRequest('{"type":"snapshot"}').snapshot.json)`,
  );
  assert.equal(migrated.project.id, "packaged-legacy");
  assert.equal(migrated.project.name, "Legacy packaged project");
  let credentialStorage = "encrypted round-trip";
  try {
    await credentials.set("pixabay", "sidecut-synthetic-smoke-secret");
    assert.equal(await credentials.read("pixabay"), "sidecut-synthetic-smoke-secret");
    const disk = await readFile(join(app.getPath("userData"), "assets/credentials/pixabay.enc"));
    assert.ok(!disk.includes(Buffer.from("sidecut-synthetic-smoke-secret")));
  } catch (error) {
    if (
      process.platform !== "linux" ||
      !(error instanceof Error) ||
      !error.message.includes("OS credential encryption is unavailable")
    )
      throw error;
    credentialStorage = "unavailable: secure keyring required (plaintext fallback refused)";
  } finally {
    await credentials.clear("pixabay");
  }
  const secondStore = new NativeProjectStore(join(app.getPath("userData"), "current.tandem"));
  await assert.rejects(() => secondStore.acquire());

  // Synthetic 48 kHz PCM needs no external fixture or filesystem path in the renderer.
  await evaluate(`(() => {
    const rate = 48000, samples = rate / 2, buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
    const text = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * Math.PI * 880 / rate) * 5000, true);
    const files = new DataTransfer(); files.items.add(new File([buffer], 'smoke.wav', { type: 'audio/wav' }));
    const input = document.querySelector('input[aria-label="Local media files"]'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(
    `JSON.parse(window.sidecutDesktop.projectRequest('{"type":"snapshot"}').snapshot.json).project.media.length === 1 && !document.querySelector('button[aria-label="Import media"]').disabled`,
  );
  await evaluate(`(() => {
    const bridge = window.sidecutDesktop, state = bridge.projectRequest(JSON.stringify({ type: 'snapshot' })).snapshot, file = JSON.parse(state.json);
    bridge.projectRequest(JSON.stringify({ type: 'apply', projectID: file.project.id, generation: state.generation, batch: {
      label: 'Packaged smoke edit', expectedRevision: file.revision, commands: [
        { updateProject: { patch: { name: 'Packaged smoke fixture' } } },
        { updateSettings: { patch: { width: 320, height: 180 } } },
        { insertClip: { trackID: file.project.audioTracks[0].id, clip: { id: 'clip_smoke', content: { media: { mediaID: file.project.media[0].id } }, start: 0, duration: .2, sourceStart: .1 } } }
      ]
    } }));
  })()`);
  await evaluate(`window.sidecutDesktop.projectFlush()`);
  await evaluate(
    `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Export').click()`,
  );
  await wait(
    `[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Queue export' && !button.disabled)`,
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Queue export').click()`,
  );
  await wait(`Boolean(document.querySelector('a[download$=".webm"]'))`);
  const media = await evaluate(`(async () => {
    const blob = await (await fetch(document.querySelector('a[download$=".webm"]').href)).arrayBuffer();
    const bridge = window.sidecutDesktop;
    const probe = JSON.parse(new TextDecoder().decode(await bridge.nativeMedia('smoke-probe', 'probe', new Uint8Array(blob))));
    const decoded = await bridge.nativeMedia('smoke-decode', 'decode', new Uint8Array(blob));
    return { bytes: blob.byteLength, codecs: probe.streams.map(stream => stream.codec_name), duration: Number(probe.format.duration), decoded: new TextDecoder().decode(decoded.slice(0, 4)) };
  })()`);
  assert.ok(media.codecs.includes("vp8"));
  assert.ok(media.codecs.includes("opus"));
  assert.equal(media.decoded, "RIFF");
  const endpoint = JSON.parse(
    await readFile(join(app.getPath("userData"), "current.tandem.api.json"), "utf8"),
  );
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/archive`, {
    method: "POST",
    headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify({ output: "packaged-smoke.sidecut" }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(
    result && typeof result === "object" && "output" in result && typeof result.output === "string",
  );
  const bytes = await readFile(result.output);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  return {
    packaged: true,
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    isolation,
    credentialStorage,
    exclusiveLock: true,
    archive: { bytes: bytes.length },
    media,
  };
}
