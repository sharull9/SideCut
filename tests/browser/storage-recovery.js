import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { ProjectCoordinator } from "../../packages/core/src/coordinator.ts";

// Run in a Vite-served browser module. Uses isolated IDs and never changes the active project.
export async function verifyStorageRecovery() {
  const assert = (v, msg) => {
    if (!v) throw new Error(msg);
  };
  const store = await BrowserProjectStore.open();
  const id = "verification_" + crypto.randomUUID();
  const c = new ProjectCoordinator(
    decodeProjectFile({ revision: 0, project: { id, name: "base" } }),
  );

  const results = [];
  const raw = await new Promise((resolve, reject) => {
    const q = indexedDB.open("sidecut", 2);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
  const write = (name, value) =>
    new Promise((resolve, reject) => {
      const t = raw.transaction(name, "readwrite");
      t.objectStore(name).put(value, id);
      t.oncomplete = resolve;
      t.onabort = () => reject(t.error);
    });
  const read = (name) =>
    new Promise((resolve, reject) => {
      const t = raw.transaction(name);
      const q = t.objectStore(name).get(id);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  await write("projects", JSON.stringify(c.projectFile()));
  await store.load(id);
  const put = IDBObjectStore.prototype.put;
  try {
    const old = await read("projects");
    c.apply({
      idempotencyKey: "first",
      author: "runtime",
      commands: [{ updateProject: { patch: { name: "first" } } }],
    });
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "journals" && args[1] === id)
        throw new DOMException("Injected journal failure", "QuotaExceededError");
      return put.apply(this, args);
    };
    let failed = false;
    try {
      await store.save(c.projectFile());
    } catch {
      failed = true;
    }
    assert(failed && (await read("projects")) === old, "journal failure replaced valid snapshot");
    IDBObjectStore.prototype.put = put;
    results.push("journal failure leaves snapshot intact");
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "projects" && args[1] === id)
        throw new DOMException("Injected snapshot failure", "QuotaExceededError");
      return put.apply(this, args);
    };
    failed = false;
    try {
      await store.save(c.projectFile());
    } catch {
      failed = true;
    }
    assert(failed && (await read("projects")) === old, "snapshot failure changed valid snapshot");
    assert(await read("journals"), "staged journal missing");
    IDBObjectStore.prototype.put = put;
    const recovery = await store.load(id);
    assert(
      recovery.revision === 1 && recovery.project.name === "first" && recovery.sidecutRecovery,
      "staged recovery failed",
    );
    results.push("interrupted snapshot recovers staged commands");
    const restored = new ProjectCoordinator(recovery);
    restored.apply({
      idempotencyKey: "first",
      commands: [{ updateProject: { patch: { name: "should not run" } } }],
    });
    assert(restored.getSnapshot().revision === 1, "retry duplicated");
    const stale = await BrowserProjectStore.open();
    await stale.load(id);
    c.apply({ commands: [{ updateProject: { patch: { name: "second" } } }] });
    await store.save(c.projectFile());
    const other = new ProjectCoordinator(recovery);
    other.apply({ commands: [{ updateProject: { patch: { name: "conflict" } } }] });
    failed = false;
    try {
      await stale.save(other.projectFile());
    } catch (e) {
      failed = String(e).includes("Save conflict");
    }
    assert(
      failed && (await store.load(id)).project.name === "second",
      "conflict overwrote current",
    );
    stale.close();
    results.push("stale writer rejected without overwriting");
    await write("projects", '{"partial":');
    const fallback = await store.load(id);
    assert(
      fallback.project.name === "first" && fallback.sidecutRecovery.includes("previous"),
      "previous recovery failed",
    );
    results.push("damaged snapshot restores previous version");
    const good = await read("projects");
    await write("journals", { previous: good, next: "partial" });
    const ignored = await store.load(id);
    assert(
      ignored.project.name === "first" && ignored.sidecutRecovery.includes("incomplete"),
      "partial journal not ignored",
    );
    results.push("partial journal preserves valid snapshot");
    return { passed: results, id, revision: ignored.revision };
  } finally {
    IDBObjectStore.prototype.put = put;
    const cleanup = raw.transaction(["projects", "journals", "previous"], "readwrite");
    for (const name of ["projects", "journals", "previous"]) cleanup.objectStore(name).delete(id);
    await new Promise((resolve, reject) => {
      cleanup.oncomplete = resolve;
      cleanup.onabort = () => reject(cleanup.error);
    });
    raw.close();
    store.close();
  }
}
