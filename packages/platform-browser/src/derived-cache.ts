import { DurableStorage } from "./sqlite-client";
import { encodeStored, decodeStored } from "./storage-codec";
const memory = new Map<string, unknown>();

// Cache data is disposable; storage failure must never prevent media processing.
export async function derivedCache<T>(key: string, value?: T): Promise<T | undefined> {
  if (value === undefined && memory.has(key)) return memory.get(key) as T;
  if (value !== undefined) {
    if (memory.size >= 12) memory.delete(memory.keys().next().value!);
    memory.set(key, value);
  }
  if (typeof window === "undefined") return value;
  try {
    const db = await DurableStorage.open();
    if (value === undefined) {
      const row = (await db.request({ type: "read", collection: "cache", key }))[0];
      return row ? ((await decodeStored(row.value, db)) as T) : undefined;
    }
    const rows = await db.request({ type: "read", collection: "cache" });
    await db.request({
      type: "commit",
      checks: [],
      writes: [
        ...rows
          .slice(0, Math.max(0, rows.length - 63))
          .filter((r) => r.key !== key)
          .map((r) => ({ collection: "cache" as const, key: r.key, value: null })),
        { collection: "cache", key, value: await encodeStored(value, db) },
      ],
    });
    return value;
  } catch {
    return value;
  }
}
