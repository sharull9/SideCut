import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { DurableStorage } from "../../packages/platform-browser/src/sqlite-client.ts";
import { AssetLibrary } from "../../packages/platform-browser/src/asset-library.ts";
import { SegmentLibrary } from "../../packages/platform-browser/src/segments.ts";
import {
  openPreferences,
  readPreference,
  writePreference,
} from "../../packages/platform-browser/src/preferences.ts";
import { encodeStored, decodeStored } from "../../packages/platform-browser/src/storage-codec.ts";
import { decodeAsset } from "../../packages/contracts/src/assets.ts";
import { decodeProjectFile, encodeProjectFile } from "../../packages/contracts/src/project.ts";
import { ProjectCoordinator } from "../../packages/core/src/coordinator.ts";
import { makeSegment } from "../../packages/core/src/segments.ts";
import { readLegacy, migrateLegacy } from "../../packages/platform-browser/src/legacy-storage.ts";
import { verifyStorageRecovery } from "./storage-recovery.js";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const base = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "legacy",
      name: "Legacy",
      videoTracks: [
        {
          id: "v",
          kind: "video",
          name: "Graphics",
          clips: [{ id: "solid", start: 0, duration: 1, content: { solid: { color: "#123456" } } }],
        },
      ],
    },
  });
async function seed(name, version, stores) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);
    open.onupgradeneeded = () => {
      for (const store of Object.keys(stores)) open.result.createObjectStore(store);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    const tx = db.transaction(Object.keys(stores), "readwrite");
    for (const [store, entries] of Object.entries(stores))
      for (const [key, value] of entries) tx.objectStore(store).put(value, key);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function seedLegacy(damaged = false) {
  const coordinator = new ProjectCoordinator(base());
  coordinator.apply({
    commands: [{ updateProject: { patch: { name: "Recovered journal" } } }],
    idempotencyKey: "legacy-edit",
  });
  const current = encodeProjectFile(base());
  await seed("sidecut", 2, {
    projects: [["legacy", damaged ? "broken" : current]],
    previous: [],
    journals: damaged
      ? []
      : [["legacy", { previous: current, next: encodeProjectFile(coordinator.projectFile()) }]],
    preferences: [["current", "legacy"]],
    resources: [
      [
        ["legacy", "audio"],
        {
          file: {
            bytes: new TextEncoder().encode("legacy audio").buffer,
            name: "资料.wav",
            type: "audio/wav",
            lastModified: 123,
          },
          state: "available",
          detail: "fixture",
        },
      ],
    ],
  });
  const asset = decodeAsset({
    provider: "local",
    providerID: "fixture",
    kind: "image",
    name: "Migrated asset",
  });
  await seed("sidecut-assets", 1, { assets: [[asset.id, { asset }]] });
  const segment = JSON.parse(
    JSON.stringify(makeSegment(base().project, ["solid"], "Legacy segment")),
  );
  await seed("sidecut-segments", 1, { segments: [[segment.id, { segment, resources: {} }]] });
  localStorage.setItem("sidecut.panel-sizes.v1", '{"version":1,"media":300}');
  return current;
}

export async function verifyMigration() {
  const passed = [];
  const store = await BrowserProjectStore.open(),
    db = await DurableStorage.open();
  const file = await store.ensureCurrent(() => {
    throw new Error("Must import existing project");
  });
  assert(
    file.project.name === "Recovered journal" && file.revision === 1,
    "Legacy journal was not recovered",
  );
  const media = await store.resource("legacy", "audio");
  assert(
    media.file.name === "资料.wav" &&
      media.file.lastModified === 123 &&
      (await media.file.text()) === "legacy audio",
    "Legacy media changed",
  );
  const legacy = await readLegacy("sidecut", ["projects", "journals"]);
  assert(
    JSON.parse(legacy.projects[0].value).project.name === "Legacy" && legacy.journals.length === 1,
    "Legacy data was modified",
  );
  passed.push("legacy snapshot, journal, and media imported without modifying originals");
  const assets = await AssetLibrary.open();
  assert(
    (await assets.entries("Migrated"))[0].asset.id === "local:fixture",
    "Asset migration failed",
  );
  const asset = (await assets.entries())[0].asset;
  await assets.put({
    asset,
    original: new File(["pixels"], "中文 picture.png", { type: "image/png", lastModified: 456 }),
  });
  assert(
    (await (await assets.get(asset.id)).original.text()) === "pixels",
    "Asset file roundtrip failed",
  );
  await assets.mergeRemote([
    { ...asset, name: "Remote overwrite" },
    { ...asset, id: "local:new", providerID: "new" },
  ]);
  assert(
    (await assets.get(asset.id)).asset.name === "Migrated asset",
    "Remote merge overwrote local metadata",
  );
  let invalid = false;
  try {
    await assets.mergeRemote([
      { ...asset, id: "local:partial", providerID: "partial" },
      { ...asset, kind: "invalid" },
    ]);
  } catch {
    invalid = true;
  }
  assert(
    invalid && (await assets.get("local:partial")) === undefined,
    "Invalid batch left a partial asset import",
  );
  const segments = await SegmentLibrary.open();
  assert(
    (await segments.list("Legacy"))[0].segment.template.duration.seconds === 1,
    "Segment migration failed",
  );
  await segments.save({
    segment: makeSegment(base().project, ["solid"], "New segment"),
    resources: {},
  });
  assert((await segments.list()).length === 2, "Segment save failed");
  passed.push("asset files and saved segments migrate and round-trip");
  await openPreferences();
  assert(
    readPreference("sidecut.panel-sizes.v1")?.includes('"media":300'),
    "Preference migration failed",
  );
  await writePreference("sidecut.test", "saved");
  const encoded = await encodeStored(
    {
      samples: new Float32Array([0.5, -0.25]),
      image: new Blob(["pixels"], { type: "image/png" }),
      data: new Uint8Array([7, 8]).buffer,
    },
    db,
  );
  const decoded = await decodeStored(encoded, db);
  assert(
    decoded.samples[0] === 0.5 &&
      (await decoded.image.text()) === "pixels" &&
      new Uint8Array(decoded.data)[1] === 8,
    "Cache codec changed data",
  );
  passed.push("preferences and binary cache values round-trip");
  let failed = false;
  try {
    await migrateLegacy("failure-test", async () => {
      throw new Error("Injected interrupted migration");
    });
  } catch {
    failed = true;
  }
  assert(
    failed &&
      !(await db.request({ type: "read", collection: "migrations", key: "failure-test" })).length,
    "Failed migration was marked complete",
  );
  await migrateLegacy("failure-test", async () => []);
  passed.push("interrupted migration is retryable");
  const stale = await BrowserProjectStore.open();
  await stale.load("legacy");
  const c = new ProjectCoordinator(file);
  c.apply({ commands: [{ updateProject: { patch: { name: "SQLite edit" } } }] });
  await store.save(c.projectFile());
  failed = false;
  try {
    await stale.save(file);
  } catch (error) {
    failed = String(error).includes("conflict");
  }
  assert(failed, "Stale writer overwrote saved data");
  passed.push("stale writer rejected");
  await store.putResource("legacy", "missing-file", {
    file: new File(["lost"], "lost.wav"),
    state: "available",
    detail: "fixture",
  });
  const missing = (
    await db.request({
      type: "read",
      collection: "resources",
      key: JSON.stringify(["legacy", "missing-file"]),
    })
  )[0];
  const fileId = JSON.parse(missing.value)[1].find(([key]) => key === "file")[1][1];
  const fileDirectory = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle("sidecut-files");
  await fileDirectory.removeEntry(fileId);
  assert(
    (await store.resource("legacy", "missing-file")) === null,
    "Missing media blocked opening instead of reporting missing",
  );
  assert(
    (await store.resources("legacy")).length === 1,
    "Missing media appeared available to archive",
  );
  passed.push("missing media remains relinkable without blocking project loading");
  passed.push(...(await verifyStorageRecovery()).passed);
  return { passed, revision: c.projectFile().revision };
}

export async function verifyReopen() {
  const store = await BrowserProjectStore.open(),
    assets = await AssetLibrary.open(),
    segments = await SegmentLibrary.open();
  assert(
    (await store.load("legacy")).project.name === "SQLite edit",
    "SQLite edit did not survive restart",
  );
  assert(
    (await (await store.resource("legacy", "audio")).file.text()) === "legacy audio",
    "Media lost after restart",
  );
  assert(
    (await (await assets.get("local:fixture")).original.text()) === "pixels",
    "Asset file lost after restart",
  );
  assert((await segments.list()).length === 2, "Segments lost after restart");
  await openPreferences();
  assert(readPreference("sidecut.test") === "saved", "Preference lost after restart");
  return true;
}

export async function verifyDamagedMigration() {
  let failed = false;
  try {
    await BrowserProjectStore.open();
  } catch {
    failed = true;
  }
  assert(failed, "Damaged legacy data silently became an empty project");
  const db = await DurableStorage.open();
  assert(
    !(await db.request({ type: "read", collection: "migrations", key: "sidecut-projects" })).length,
    "Damaged import was marked complete",
  );
  assert(
    !(await db.request({ type: "read", collection: "projects" })).length,
    "Failed import left partial project data",
  );
  await seed("sidecut", 2, { projects: [["legacy", encodeProjectFile(base())]] });
  assert(
    (await (await BrowserProjectStore.open()).load("legacy")).project.name === "Legacy",
    "Repair could not retry migration",
  );
  return true;
}

export async function concurrentWrite(key, expected, next) {
  const db = await DurableStorage.open();
  try {
    await db.request({
      type: "commit",
      checks: [{ collection: "preferences", key, value: expected }],
      writes: [{ collection: "preferences", key, value: next }],
    });
    return "committed";
  } catch (error) {
    if (String(error).includes("conflict")) return "conflict";
    throw error;
  }
}
