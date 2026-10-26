import {
  decodeStorageRows,
  type StorageRequest,
  type StorageRow,
} from "@sidecut/contracts/storage";
import type { NativeBridge } from "@sidecut/contracts/desktop";

let connection: Promise<DurableStorage> | undefined;

export class DurableStorage {
  private constructor(
    readonly request: (request: StorageRequest) => Promise<readonly StorageRow[]>,
    readonly putFile: (bytes: Uint8Array) => Promise<string>,
    readonly getFile: (id: string) => Promise<Uint8Array<ArrayBuffer>>,
    readonly native = false,
    readonly removeFile: (id: string) => Promise<void> = async () => {},
  ) {}

  static open(): Promise<DurableStorage> {
    return (connection ??= this.connect().catch((error) => {
      connection = undefined;
      throw error;
    }));
  }

  private static async connect() {
    const bridge: NativeBridge | undefined =
      typeof window === "undefined"
        ? undefined
        : (window as Window & { sidecutDesktop?: NativeBridge }).sidecutDesktop;
    if (bridge?.storageRequest && bridge.storagePutFile && bridge.storageGetFile) {
      const request = bridge.storageRequest,
        put = bridge.storagePutFile,
        get = bridge.storageGetFile;
      return new DurableStorage(
        async (value) => decodeStorageRows(await request(value)),
        put,
        async (id) => new Uint8Array(await get(id)),
        true,
        async (id) => {
          await bridge.storageRemoveFile?.(id);
        },
      );
    }
    if (!globalThis.isSecureContext || !navigator.storage?.getDirectory || !navigator.locks)
      throw new Error(
        "SQLite storage requires a secure browser with OPFS and Web Locks. Use HTTPS or the desktop app.",
      );
    let directory: FileSystemDirectoryHandle;
    try {
      const root = await navigator.storage.getDirectory();
      directory = await root.getDirectoryHandle("sidecut-files", { create: true });
    } catch (error) {
      throw new Error(
        `SQLite browser storage is unavailable. Use a browser with working OPFS storage or the desktop app. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const worker = new Worker(new URL("./sqlite-worker.ts", import.meta.url), { type: "module" });
    let sequence = 0,
      failure: Error | undefined;
    const pending = new Map<
      number,
      {
        resolve: (rows: readonly StorageRow[]) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    const fail = (error: Error) => {
      failure = error;
      worker.terminate();
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(error);
      }
      pending.clear();
    };
    worker.onerror = () =>
      fail(
        new Error("SQLite worker could not start. Reload the app; your saved data was retained."),
      );
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "number")
        return;
      const task = pending.get(value.id);
      if (!task) return;
      pending.delete(value.id);
      clearTimeout(task.timer);
      if ("error" in value && typeof value.error === "string") task.reject(new Error(value.error));
      else
        try {
          task.resolve(decodeStorageRows("result" in value ? value.result : undefined));
        } catch {
          task.reject(new Error("SQLite returned an invalid response."));
        }
    };
    const request = (value: StorageRequest) =>
      new Promise<readonly StorageRow[]>((resolve, reject) => {
        if (failure) {
          reject(failure);
          return;
        }
        const id = ++sequence;
        const timer = setTimeout(
          () =>
            fail(
              new Error(
                "SQLite did not confirm the operation. Reload to check saved state before retrying.",
              ),
            ),
          30000,
        );
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, request: value });
      });
    const storage = new DurableStorage(
      request,
      async (bytes) => {
        const id = crypto.randomUUID();
        const handle = await directory.getFileHandle(id, { create: true });
        const writer = await handle.createWritable();
        try {
          await writer.write(new Uint8Array(bytes));
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        }
        return id;
      },
      async (id) => {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid stored file ID.");
        try {
          return new Uint8Array(
            await (await (await directory.getFileHandle(id)).getFile()).arrayBuffer(),
          );
        } catch (error) {
          if (error instanceof DOMException && error.name === "NotFoundError")
            throw new Error("Stored media file is missing. Relink the source.", { cause: error });
          throw error;
        }
      },
      false,
      async (id) => {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid stored file ID.");
        try {
          await directory.removeEntry(id);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
        }
      },
    );
    await storage.request({ type: "read", collection: "migrations", key: "ready" });
    return storage;
  }
}
