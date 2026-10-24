import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { DurableStorage } from "../../packages/platform-browser/src/sqlite-client.ts";
import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { ProjectCoordinator } from "../../packages/core/src/coordinator.ts";

// Run in a fresh Vite-served test profile. Does not change the current-project preference.
export async function verifyStorageRecovery() {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const store = await BrowserProjectStore.open(),
    db = await DurableStorage.open();
  const id = "verification_" + crypto.randomUUID();
  const coordinator = new ProjectCoordinator(
    decodeProjectFile({ revision: 0, project: { id, name: "base" } }),
  );
  const request = db.request;
  const results = [];
  try {
    await store.save(coordinator.projectFile());
    coordinator.apply({ commands: [{ updateProject: { patch: { name: "first" } } }] });
    db.request = async (operation) => {
      if (
        operation.type === "commit" &&
        operation.writes.some((write) => write.collection === "projects" && write.key === id)
      )
        throw new DOMException("Injected full disk", "QuotaExceededError");
      return request(operation);
    };
    let failed = false;
    try {
      await store.save(coordinator.projectFile());
    } catch {
      failed = true;
    }
    db.request = request;
    assert(
      failed && (await store.load(id)).project.name === "base",
      "Failed save replaced the committed snapshot",
    );
    results.push("failed save retains committed snapshot");
    await store.save(coordinator.projectFile());
    const stale = await BrowserProjectStore.open();
    await stale.load(id);
    coordinator.apply({ commands: [{ updateProject: { patch: { name: "second" } } }] });
    await store.save(coordinator.projectFile());
    failed = false;
    try {
      await stale.save(decodeProjectFile({ revision: 0, project: { id, name: "stale" } }));
    } catch (error) {
      failed = String(error).includes("conflict");
    }
    assert(
      failed && (await store.load(id)).project.name === "second",
      "Stale save overwrote newer data",
    );
    results.push("stale writer rejected");
    await request({
      type: "commit",
      checks: [],
      writes: [{ collection: "projects", key: id, value: "partial" }],
    });
    const recovered = await store.load(id);
    assert(
      recovered.project.name === "first" && recovered.sidecutRecovery,
      "Previous snapshot recovery failed",
    );
    results.push("damaged snapshot recovers previous valid version");
    return { passed: results, id };
  } finally {
    db.request = request;
    await request({
      type: "commit",
      checks: [],
      writes: [
        { collection: "projects", key: id, value: null },
        { collection: "previous", key: id, value: null },
      ],
    });
    store.close();
  }
}
