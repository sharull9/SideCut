import {
  decodeStorageRows,
  type StorageRequest,
  type StorageRow,
} from "@sidecut/contracts/storage";
import type { NativeFileReference } from "@sidecut/contracts/native-recording";
import type { NativeBridge } from "@sidecut/contracts/desktop";

const chunkSize = 4 * 1024 * 1024;
const associated = new WeakMap<Blob, string>();
const hydrated = new Map<string, Promise<File>>();
/** Only for a fresh adoption that never became a committed project resource. */
export async function discardNativeFile(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid native file ID.");
  const bridge = (window as Window & { sidecutDesktop?: NativeBridge }).sidecutDesktop;
  await bridge?.storageRemoveFile?.(id);
  hydrated.delete(id);
  await (await opfsDirectory()).removeEntry(id).catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  });
}
async function opfsDirectory() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle("sidecut-files", {
    create: true,
  });
}
export async function nativeFile(reference: NativeFileReference): Promise<File> {
  const bridge = (window as Window & { sidecutDesktop?: NativeBridge }).sidecutDesktop;
  if (!bridge?.storageFileRead || !bridge.storageFileSize)
    throw new Error("Native file access is unavailable.");
  if (
    !/^[a-f0-9-]{36}$/.test(reference.id) ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes < 0 ||
    reference.bytes > 100 * 1024 ** 3
  )
    throw new Error("Invalid native file reference.");
  if ((await bridge.storageFileSize(reference.id)) !== reference.bytes)
    throw new Error("Stored media file is missing or truncated.");
  let promise = hydrated.get(reference.id);
  if (!promise) {
    promise = (async () => {
      const directory = await opfsDirectory();
      const handle = await directory.getFileHandle(reference.id, { create: true });
      let file = await handle.getFile();
      if (file.size !== reference.bytes) {
        const writer = await handle.createWritable();
        try {
          for (let offset = 0; offset < reference.bytes; offset += chunkSize) {
            const length = Math.min(chunkSize, reference.bytes - offset);
            const bytes = await bridge.storageFileRead!(reference.id, offset, length);
            if (!(bytes instanceof Uint8Array) || bytes.length !== length)
              throw new Error("Stored media file is truncated.");
            await writer.write(new Uint8Array(bytes));
          }
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          await directory.removeEntry(reference.id).catch(() => {});
          throw error;
        }
        file = await handle.getFile();
      }
      if (file.size !== reference.bytes) throw new Error("Stored media file is truncated.");
      return file;
    })();
    hydrated.set(reference.id, promise);
    promise.catch(() => hydrated.delete(reference.id));
  }
  const source = await promise;
  const result = new File([source], reference.name, {
    type: reference.type,
    lastModified: reference.lastModified,
  });
  associated.set(result, reference.id);
  return result;
}
let connection: Promise<DurableStorage> | undefined;

export class DurableStorage {
  private constructor(
    readonly request: (request: StorageRequest) => Promise<readonly StorageRow[]>,
    readonly putFile: (bytes: Uint8Array) => Promise<string>,
    readonly getFile: (id: string) => Promise<Uint8Array<ArrayBuffer>>,
    readonly native = false,
    readonly removeFile: (id: string) => Promise<void> = async () => {},
    readonly putBlob: (blob: Blob) => Promise<string> = async (blob) => {
      throw new Error(`Blob storage unavailable (${blob.size}).`);
    },
    readonly getBlob: (
      id: string,
      type?: string,
      name?: string,
      lastModified?: number,
    ) => Promise<Blob | File> = async () => {
      throw new Error("Blob storage unavailable.");
    },
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
        async (blob) => {
          const existing = associated.get(blob);
          if (
            existing &&
            bridge.storageFileSize &&
            (await bridge.storageFileSize(existing)) === blob.size
          )
            return existing;
          if (
            !bridge.storageFileBegin ||
            !bridge.storageFileAppend ||
            !bridge.storageFileSeal ||
            !bridge.storageFileAbort
          )
            return put(new Uint8Array(await blob.arrayBuffer()));
          const id = await bridge.storageFileBegin();
          try {
            for (let offset = 0; offset < blob.size; offset += chunkSize)
              await bridge.storageFileAppend(
                id,
                new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()),
              );
            await bridge.storageFileSeal(id);
            associated.set(blob, id);
            return id;
          } catch (error) {
            await bridge.storageFileAbort(id).catch(() => {});
            throw error;
          }
        },
        async (id, type = "", name, lastModified = 0) => {
          if (!bridge.storageFileSize || !bridge.storageFileRead) {
            const bytes = new Uint8Array(await get(id));
            return name === undefined
              ? new Blob([bytes], { type })
              : new File([bytes], name, { type, lastModified });
          }
          const file = await nativeFile({
            id,
            name: name ?? id,
            type,
            bytes: await bridge.storageFileSize(id),
            lastModified,
          });
          if (name !== undefined) return file;
          const blob = file.slice(0, file.size, type);
          associated.set(blob, id);
          return blob;
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
      async (blob) => {
        const id = crypto.randomUUID();
        const handle = await directory.getFileHandle(id, { create: true });
        const writer = await handle.createWritable();
        try {
          await blob.stream().pipeTo(writer);
        } catch (error) {
          await directory.removeEntry(id).catch(() => {});
          throw error;
        }
        return id;
      },
      async (id, type = "", name, lastModified = 0) => {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid stored file ID.");
        const file = await (await directory.getFileHandle(id)).getFile();
        return name === undefined
          ? file.slice(0, file.size, type)
          : new File([file], name, { type, lastModified });
      },
    );
    await storage.request({ type: "read", collection: "migrations", key: "ready" });
    return storage;
  }
}
