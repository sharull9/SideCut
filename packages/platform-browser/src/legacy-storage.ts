import type { StorageCollection, StorageRequest } from "@sidecut/contracts/storage";
import { DurableStorage } from "./sqlite-client";
import { encodeStored } from "./storage-codec";

export interface LegacyEntry {
  key: IDBValidKey;
  value: unknown;
}
export async function readLegacy(
  name: string,
  stores: readonly string[],
): Promise<Record<string, LegacyEntry[]>> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name);
    let absent = false;
    open.onupgradeneeded = () => {
      absent = true;
      open.transaction?.abort();
    };
    open.onerror = () => (absent ? resolve({}) : reject(open.error));
    open.onblocked = () =>
      reject(new Error("Close other SideCut tabs before migrating saved data."));
    open.onsuccess = () => {
      const db = open.result;
      const existing = stores.filter((s) => db.objectStoreNames.contains(s));
      if (!existing.length) {
        db.close();
        resolve({});
        return;
      }
      const tx = db.transaction(existing);
      const result: Record<string, LegacyEntry[]> = {};
      for (const storeName of existing) {
        const cursor = tx.objectStore(storeName).openCursor();
        result[storeName] = [];
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          result[storeName]!.push({ key: cursor.result.key, value: cursor.result.value });
          cursor.result.continue();
        };
      }
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error("Legacy storage could not be read."));
      };
    };
  });
}

type Writes = Extract<StorageRequest, { type: "commit" }>["writes"];
export async function migrateLegacy(
  marker: string,
  prepare: (storage: DurableStorage) => Promise<Writes>,
) {
  const storage = await DurableStorage.open();
  await navigator.locks.request(`sidecut:migrate:${marker}`, async () => {
    if ((await storage.request({ type: "read", collection: "migrations", key: marker })).length)
      return;
    const writes = await prepare(storage);
    await storage.request({
      type: "commit",
      checks: [{ collection: "migrations", key: marker, value: null }],
      writes: [...writes, { collection: "migrations", key: marker, value: "1" }],
    });
  });
  return storage;
}

export async function migrateLibrary(
  collection: StorageCollection,
  name: string,
  store: string,
  validate: (value: unknown) => unknown,
) {
  return migrateLegacy(name, async (storage) => {
    const legacy = await readLegacy(name, [store]);
    return Promise.all(
      (legacy[store] ?? []).map(async ({ key, value }) => {
        if (typeof key !== "string") throw new Error("Legacy library has an invalid ID.");
        return { collection, key, value: await encodeStored(validate(value), storage) };
      }),
    );
  });
}
