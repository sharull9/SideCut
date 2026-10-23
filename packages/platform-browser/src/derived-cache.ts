const memory = new Map<string, unknown>();

// Derived data is disposable. Quota/private-mode failures fall back to bounded memory.
export async function derivedCache<T>(key: string, value?: T): Promise<T | undefined> {
  if (value === undefined && memory.has(key)) return memory.get(key) as T;
  if (value !== undefined) {
    if (memory.size >= 12) memory.delete(memory.keys().next().value!);
    memory.set(key, value);
  }
  if (typeof indexedDB === "undefined") return value;
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const open = indexedDB.open("sidecut-derived", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("analysis");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("analysis", value === undefined ? "readonly" : "readwrite");
        const request =
          value === undefined
            ? tx.objectStore("analysis").get(key)
            : tx.objectStore("analysis").put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve(value ?? request.result);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  } catch {
    return value;
  }
}
