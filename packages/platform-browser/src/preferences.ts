import { migrateLegacy } from "./legacy-storage";
import type { DurableStorage } from "./sqlite-client";

const values = new Map<string, string>();
let ready: Promise<DurableStorage> | undefined;
export function openPreferences() {
  return (ready ??= migrateLegacy("local-preferences", async () => {
    const writes = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("sidecut:") || key.startsWith("sidecut."))) {
        const value = localStorage.getItem(key);
        if (value !== null) writes.push({ collection: "preferences" as const, key, value });
      }
    }
    return writes;
  })
    .then(async (db) => {
      for (const row of await db.request({ type: "read", collection: "preferences" }))
        values.set(row.key, row.value);
      return db;
    })
    .catch((error) => {
      ready = undefined;
      throw error;
    }));
}
export const readPreference = (key: string) => values.get(key) ?? null;
export async function writePreference(key: string, value: string) {
  const db = await openPreferences();
  await db.request({
    type: "commit",
    checks: [],
    writes: [{ collection: "preferences", key, value }],
  });
  values.set(key, value);
}
