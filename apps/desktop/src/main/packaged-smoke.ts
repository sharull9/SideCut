import assert from "node:assert/strict";
import { app } from "electron";
import type { BrowserWindow } from "electron";
import type { ProviderCredentials } from "./provider-credentials.ts";
import { readFile, writeFile, mkdir, copyFile, readdir, stat, link } from "node:fs/promises";
import { join } from "node:path";
import { NativeProjectStore } from "./project-store.ts";
import { createHash } from "node:crypto";
import { mediaBinaries } from "./media-binaries.ts";
import { NativeRecorder } from "./native-recorder.ts";
import type { NativeRecording } from "@sidecut/contracts/native-recording";
import { DatabaseSync } from "node:sqlite";
import { NativeStorage, openSQLite } from "./sqlite-storage.ts";

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
  await wait(
    `document.querySelector('.editor-brand img')?.naturalWidth > 0 && document.title === 'raE.E'`,
  );
  const branding = await evaluate(`(async () => ({
    title: document.title,
    wordmark: document.querySelector('.editor-brand')?.textContent.trim(),
    label: document.querySelector('main')?.getAttribute('aria-label'),
    markLoaded: document.querySelector('.editor-brand img')?.naturalWidth > 0,
    faviconLoaded: (await fetch(document.querySelector('link[rel="icon"][type="image/svg+xml"]').href)).ok,
  }))()`);
  assert.equal(app.getName(), "raE.E");
  assert.equal(branding.title, "raE.E");
  assert.equal(branding.wordmark, "raE.E");
  assert.equal(branding.label, "raE.E video editor");
  assert.equal(branding.markLoaded, true);
  assert.equal(branding.faviconLoaded, true);
  const futureDatabase = await verifyFutureDatabase();
  const panelPreferences = await verifyPanelPreferences(window, wait);
  const nativeRecording = await verifyNativeRecording(window);
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
      nativeRecording,
      panelPreferences,
      futureDatabase,
      branding,
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
  const supportResponse = await fetch(`http://127.0.0.1:${endpoint.port}/v1/diagnostics`, {
    method: "POST",
    headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify({ output: "packaged-support.json" }),
  });
  assert.equal(supportResponse.status, 200);
  const supportText = await readFile(
    join(app.getPath("userData"), "exports/packaged-support.json"),
    "utf8",
  );
  const support = JSON.parse(supportText);
  assert.equal(support.format, "sidecut-support");
  assert.equal(support.version, 1);
  assert.equal(support.project.mediaCount, 1);
  for (const privateValue of [
    endpoint.token,
    app.getPath("userData"),
    "Packaged smoke fixture",
    "smoke.wav",
  ])
    assert.ok(
      !supportText.includes(privateValue) &&
        !supportText.includes(JSON.stringify(privateValue).slice(1, -1)),
    );
  const beforeSupportUI = await evaluate(
    `window.sidecutDesktop.projectRequest('{"type":"snapshot"}').snapshot.json`,
  );
  await evaluate(`document.querySelector('a[href="/diagnostics"]').click()`);
  const createReport = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Create support report')`;
  const reportLink = `document.querySelector('a[download="sidecut-support.json"]')`;
  await wait(`Boolean(${createReport})`);
  await evaluate(`${createReport}.click()`);
  await wait(`Boolean(${reportLink})`);
  const supportDownload = await evaluate(`(async () => {
    const link = ${reportLink}, response = await fetch(link.href);
    return { url: link.href, text: await response.text(), type: response.headers.get('content-type') };
  })()`);
  assert.equal(supportDownload.type, "application/json");
  const uiReport = JSON.parse(supportDownload.text);
  assert.equal(uiReport.format, "sidecut-support");
  assert.equal(uiReport.version, 1);
  assert.equal(uiReport.project.mediaCount, 1);
  for (const privateValue of [
    endpoint.token,
    app.getPath("userData"),
    "Packaged smoke fixture",
    "smoke.wav",
  ])
    assert.ok(
      !supportDownload.text.includes(privateValue) &&
        !supportDownload.text.includes(JSON.stringify(privateValue).slice(1, -1)),
    );
  await evaluate(`${createReport}.click()`);
  await wait(
    `Boolean(${reportLink} && ${reportLink}.href !== ${JSON.stringify(supportDownload.url)})`,
  );
  assert.equal(
    await evaluate(`fetch(${JSON.stringify(supportDownload.url)}).then(() => false, () => true)`),
    true,
  );
  const secondURL = await evaluate(`${reportLink}.href`);
  await evaluate(
    `[...document.querySelectorAll('a')].find(link => link.textContent.trim() === 'Back to editor').click()`,
  );
  await wait(`Boolean(document.querySelector('button[aria-label="Import media"]'))`);
  assert.equal(
    await evaluate(`fetch(${JSON.stringify(secondURL)}).then(() => false, () => true)`),
    true,
  );
  assert.equal(
    await evaluate(`window.sidecutDesktop.projectRequest('{"type":"snapshot"}').snapshot.json`),
    beforeSupportUI,
  );
  const supportUI = {
    downloaded: true,
    contentExcluded: true,
    replacementRevoked: true,
    unmountRevoked: true,
    projectUnchanged: true,
  };
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
    nativeRecording,
    panelPreferences,
    support: { report: support, contentExcluded: true },
    supportUI,
    futureDatabase,
    branding,
  };
}

async function verifyFutureDatabase() {
  const hashes: string[] = [];
  for (const mode of ["delete", "wal"]) {
    const root = join(app.getPath("userData"), "future-database", mode);
    await mkdir(root, { recursive: true });
    const path = join(root, "sidecut.sqlite");
    if (!app.commandLine.hasSwitch("smoke-reopen")) {
      const fixture = new DatabaseSync(path);
      try {
        fixture.exec(`PRAGMA journal_mode=${mode}; PRAGMA user_version=2;
          CREATE TABLE future_data(value TEXT);
          INSERT INTO future_data VALUES('preserve newer settings and library data');`);
      } finally {
        fixture.close();
      }
    }
    const before = await readFile(path),
      files = (await readdir(root)).sort();
    assert.throws(() => openSQLite(path), /newer raE.E/);
    assert.throws(() => new NativeStorage(root), /newer raE.E/);
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual((await readdir(root)).sort(), files);
    const store = new NativeProjectStore(join(root, "current.tandem"));
    try {
      await store.acquire();
      await assert.rejects(
        () =>
          store.load(() => {
            throw new Error("must not create a project");
          }),
        /newer raE.E/,
      );
    } finally {
      await store.close();
    }
    assert.deepEqual(await readFile(path), before);
    hashes.push(createHash("sha256").update(before).digest("hex"));
  }
  return { cases: 2, refused: true, bytesPreserved: true, filesPreserved: true, hashes };
}

async function verifyPanelPreferences(
  window: BrowserWindow,
  wait: (source: string) => Promise<void>,
) {
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const key = "sidecut.panel-sizes.v1";
  const read = `window.sidecutDesktop.storageRequest({ type: 'read', collection: 'preferences', key: '${key}' })`;
  const reset = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Reset layout')`;
  const protectedLayout = `[...document.querySelectorAll('[role="status"]')].some(element => element.textContent.includes('Temporary layout'))`;
  const divider = `document.querySelector('[role="separator"][aria-label="Media panel width"]')`;
  const reload = async () => {
    const loaded = new Promise<void>((resolve) =>
      window.webContents.once("did-finish-load", () => resolve()),
    );
    window.webContents.reload();
    await loaded;
    await wait(`Boolean(${reset} && !${reset}.disabled)`);
  };
  const unreadable = [
    JSON.stringify({ version: 2, media: 410, inspector: 330, workspace: null, future: "retained" }),
    "{damaged layout",
    JSON.stringify({ version: 1, media: "wide", inspector: 330, workspace: null }),
  ];
  for (const raw of unreadable) {
    await evaluate(
      `window.sidecutDesktop.storageRequest(${JSON.stringify({ type: "commit", checks: [], writes: [{ collection: "preferences", key, value: raw }] })})`,
    );
    await reload();
    await wait(protectedLayout);
    assert.equal((await evaluate(read))[0]?.value, raw);
    const before = await evaluate(`Number(${divider}.getAttribute('aria-valuenow'))`);
    await evaluate(
      `${divider}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`,
    );
    await wait(`Number(${divider}.getAttribute('aria-valuenow')) > ${before}`);
    assert.equal((await evaluate(read))[0]?.value, raw);
    await reload();
    await wait(protectedLayout);
    assert.equal((await evaluate(read))[0]?.value, raw);
    await evaluate(`${reset}.click()`);
    await wait(`!(${protectedLayout})`);
    await wait(
      `(async () => { const rows = await ${read}; return rows.length === 1 && rows[0].value !== ${JSON.stringify(raw)} && JSON.parse(rows[0].value).version === 1; })()`,
    );
  }
  const saved = (await evaluate(read))[0]?.value;
  await reload();
  assert.equal(await evaluate(protectedLayout), false);
  assert.equal((await evaluate(read))[0]?.value, saved);
  const before = await evaluate(`Number(${divider}.getAttribute('aria-valuenow'))`);
  await evaluate(
    `${divider}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`,
  );
  await wait(
    `(async () => { const rows = await ${read}; return JSON.parse(rows[0].value).media > ${before}; })()`,
  );
  const resized = (await evaluate(read))[0]?.value;
  await reload();
  assert.equal((await evaluate(read))[0]?.value, resized);
  assert.equal(
    await evaluate(`Number(${divider}.getAttribute('aria-valuenow'))`),
    JSON.parse(resized).media,
  );
  return {
    unreadableCases: unreadable.length,
    originalPreserved: true,
    temporaryResize: true,
    resetPersisted: true,
    resizePersisted: true,
    reloaded: true,
  };
}

async function verifyNativeRecording(window: BrowserWindow) {
  const { ffmpeg, ffprobe } = mediaBinaries({}, process.resourcesPath);
  // Only the input is synthetic; use the shipped engine, journals, binaries and renderer bridge.
  const recorder = new NativeRecorder(
    ffmpeg,
    ffprobe,
    join(app.getPath("userData"), "packaged-recording-fixture"),
    {
      inputProvider: async () => ({
        args: [
          "-re",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=320x180:rate=30",
          "-re",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=880:sample_rate=48000",
        ],
        video: true,
        audio: true,
      }),
    },
  );
  try {
    if (!app.commandLine.hasSwitch("smoke-reopen")) {
      assert.deepEqual(await recorder.list(), []);
      const started = await recorder.start({
        projectID: "packaged-legacy",
        source: "camera",
        encoder: "software",
      });
      await assert.rejects(() => recorder.stop("stale-recording"), /Recording changed/);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      assert.equal((await recorder.stop(started.id)).status, "ready");
    }
    const entries = await recorder.list();
    assert.equal(entries.length, 1);
    const recording = entries[0];
    assert.ok(recording);
    assert.equal(recording.status, "ready");
    assert.equal(recording.encoder, "libx264");
    assert.deepEqual(recording.tracks.map((track) => track.kind).sort(), ["audio", "video"]);
    assert.ok(recording.tracks.every((track) => track.durationSeconds > 0));
    assert.equal("journalVersion" in recording, false);
    const bytes = await recorder.withSavedRecording(recording.id, async (_, folder) => {
      assert.equal(
        JSON.parse(await readFile(join(folder, "metadata.json"), "utf8")).journalVersion,
        1,
      );
      return readFile(join(folder, "recording.mp4"));
    });
    assert.equal(bytes.length, recording.bytes);
    const decoded = await decodeRecording(window, bytes);
    const repair = await verifyPackagedRepair(window, recorder, recording);
    return {
      input: "synthetic lavfi video and tone",
      encoder: recording.encoder,
      bytes: recording.bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      diskJournalVersion: 1,
      ...decoded,
      repair,
    };
  } finally {
    await recorder.close();
  }
}

async function decodeRecording(window: BrowserWindow, bytes: Uint8Array) {
  const decoded = await window.webContents.executeJavaScript(`(async () => {
      const bridge = window.sidecutDesktop, bytes = new Uint8Array(${JSON.stringify([...bytes])});
      const probe = JSON.parse(new TextDecoder().decode(await bridge.nativeMedia('recording-probe', 'probe', bytes)));
      const output = await bridge.nativeMedia('recording-decode', 'export', bytes);
      const decoded = JSON.parse(new TextDecoder().decode(await bridge.nativeMedia('recording-decoded-probe', 'probe', output)));
      return { codecs: probe.streams.map(stream => stream.codec_name).sort(),
        decodedCodecs: decoded.streams.map(stream => stream.codec_name).sort(),
        duration: Number(decoded.format.duration) };
    })()`);
  assert.deepEqual(decoded.codecs, ["aac", "h264"]);
  assert.deepEqual(decoded.decodedCodecs, ["opus", "vp8"]);
  assert.ok(decoded.duration > 0);
  return decoded;
}

async function verifyPackagedRepair(
  window: BrowserWindow,
  original: NativeRecorder,
  recording: NativeRecording,
) {
  const root = join(app.getPath("userData"), "packaged-repair-fixture");
  const corruptID = "00000000-0000-4000-8000-000000000001";
  const publishedID = "00000000-0000-4000-8000-000000000002";
  const futureID = "00000000-0000-4000-8000-000000000004";
  const goodFolder = join(root, recording.id),
    badFolder = join(root, corruptID),
    publishedFolder = join(root, publishedID);
  const orphan = join(publishedFolder, "remux-00000000-0000-4000-8000-000000000003.mp4");
  const futureFolder = join(root, futureID),
    futurePath = join(futureFolder, "metadata.json");
  const corrupt = Buffer.from("synthetic damaged Matroska source");
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  if (!app.commandLine.hasSwitch("smoke-reopen")) {
    for (const id of [recording.id, corruptID, publishedID]) {
      await mkdir(join(root, id), { recursive: true });
      await writeFile(
        join(root, id, "metadata.json"),
        JSON.stringify({ ...recording, id, status: "stopping" }),
      );
    }
    await original.withSavedRecording(recording.id, (_, folder) =>
      copyFile(join(folder, "recording.mkv"), join(goodFolder, "recording.mkv")),
    );
    await original.withSavedRecording(recording.id, async (_, folder) => {
      await copyFile(join(folder, "recording.mkv"), join(publishedFolder, "recording.mkv"));
      await copyFile(join(folder, "recording.mp4"), join(publishedFolder, "recording.mp4"));
    });
    await link(join(publishedFolder, "recording.mp4"), orphan);
    await mkdir(futureFolder);
    await writeFile(
      futurePath,
      JSON.stringify({
        ...recording,
        id: futureID,
        journalVersion: 2,
        status: "stopping",
        futureMetadata: { retained: true },
      }),
    );
    await writeFile(join(futureFolder, "recording.mkv"), "future source bytes");
    await writeFile(join(badFolder, "recording.mkv"), corrupt);
    return {
      fixture: "simulated interrupted journals; synthetic intact and damaged sources",
      staged: true,
      sourceSHA256: digest(await readFile(join(goodFolder, "recording.mkv"))),
      publishedSHA256: digest(await readFile(join(publishedFolder, "recording.mp4"))),
      futureJournalSHA256: digest(await readFile(futurePath)),
    };
  }
  const { ffmpeg, ffprobe } = mediaBinaries({}, process.resourcesPath);
  const recorder = new NativeRecorder(ffmpeg, ffprobe, root);
  try {
    const futureJournal = await readFile(futurePath);
    const rows = await recorder.list();
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.status === "interrupted"));
    for (const row of rows) {
      assert.equal("journalVersion" in row, false);
      assert.equal(
        JSON.parse(await readFile(join(root, row.id, "metadata.json"), "utf8")).journalVersion,
        1,
      );
    }
    await assert.rejects(recorder.retry(futureID), /Unsupported recording journal version/);
    assert.deepEqual(await readFile(futurePath), futureJournal);
    assert.equal(
      await readFile(join(futureFolder, "recording.mkv"), "utf8"),
      "future source bytes",
    );
    const source = await readFile(join(goodFolder, "recording.mkv"));
    const recovered = await recorder.retry(recording.id);
    assert.equal(recovered.status, "ready");
    const bytes = await recorder.withSavedRecording(recording.id, (_, folder) =>
      readFile(join(folder, "recording.mp4")),
    );
    const decoded = await decodeRecording(window, bytes);
    assert.deepEqual(await readFile(join(goodFolder, "recording.mkv")), source);
    const publishedPath = join(publishedFolder, "recording.mp4"),
      published = await readFile(publishedPath),
      publishedStat = await stat(publishedPath);
    assert.deepEqual(await readFile(orphan), published);
    assert.equal((await recorder.retry(publishedID)).status, "ready");
    await assert.rejects(stat(orphan), { code: "ENOENT" });
    assert.deepEqual(await readFile(publishedPath), published);
    assert.equal((await stat(publishedPath)).ino, publishedStat.ino);
    assert.equal((await stat(publishedPath)).mtimeMs, publishedStat.mtimeMs);
    assert.deepEqual(await readFile(join(publishedFolder, "recording.mkv")), source);
    assert.equal((await recorder.retry(corruptID)).status, "error");
    assert.deepEqual(await readFile(join(badFolder, "recording.mkv")), corrupt);
    assert.deepEqual((await readdir(badFolder)).sort(), ["metadata.json", "recording.mkv"]);
    assert.deepEqual((await readdir(goodFolder)).sort(), [
      "metadata.json",
      "recording.mkv",
      "recording.mp4",
    ]);
    assert.deepEqual((await readdir(publishedFolder)).sort(), (await readdir(goodFolder)).sort());
    return {
      fixture: "simulated interrupted journals; synthetic intact and damaged sources",
      reopened: true,
      recovered: true,
      sourcePreserved: true,
      sourceSHA256: digest(source),
      publishedRecovered: true,
      publishedPreserved: true,
      publishedRemuxRemoved: true,
      legacyJournalsUpgraded: true,
      futureJournalPreserved: true,
      futureJournalSHA256: digest(futureJournal),
      publishedSHA256: digest(published),
      corruptRejected: true,
      corruptSourcePreserved: true,
      temporaryFilesRemoved: true,
      ...decoded,
    };
  } finally {
    await recorder.close();
  }
}
