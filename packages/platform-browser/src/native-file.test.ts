import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DurableStorage, nativeFile } from "./sqlite-client";

const chunk = 4 * 1024 * 1024;
const reference = (id: string, bytes: number) => ({
  id,
  bytes,
  name: "capture.mp4",
  type: "video/mp4",
  lastModified: 42,
});

function setup(bytes: Uint8Array) {
  const files = new Map<string, File>();
  const abort = vi.fn(async () => {});
  const removeEntry = vi.fn(async (id: string) => {
    files.delete(id);
  });
  const directory = {
    removeEntry,
    getFileHandle: async (id: string) => ({
      getFile: async () => files.get(id) ?? new File([], id),
      createWritable: async () => {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        return {
          write: async (part: Uint8Array) => {
            parts.push(new Uint8Array(part));
          },
          close: async () => {
            files.set(id, new File(parts, id));
          },
          abort,
        };
      },
    }),
  };
  const read = vi.fn(async (_id: string, offset: number, length: number) =>
    bytes.slice(offset, offset + length),
  );
  const bridge = {
    storageFileSize: vi.fn(async () => bytes.length),
    storageFileRead: read,
    storageRequest: vi.fn(async () => []),
    storagePutFile: vi.fn(async () => "legacy"),
    storageGetFile: vi.fn(async () => bytes),
  };
  vi.stubGlobal("window", { sidecutDesktop: bridge });
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) },
  });
  return { files, abort, removeEntry, read, bridge };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("native file hydration", () => {
  it("reads at most 4 MiB per range and reuses the hydrated immutable file", async () => {
    const bytes = new Uint8Array(chunk * 2 + 7);
    bytes[0] = 3;
    bytes[chunk] = 5;
    bytes[bytes.length - 1] = 9;
    const { read } = setup(bytes);
    const ref = reference("11111111-1111-4111-8111-111111111111", bytes.length);
    const first = await nativeFile(ref);
    const second = await nativeFile({ ...ref, name: "renamed.mp4" });
    expect(read.mock.calls.map(([, offset, length]) => [offset, length])).toEqual([
      [0, chunk],
      [chunk, chunk],
      [chunk * 2, 7],
    ]);
    expect(Buffer.from(await first.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect(second.name).toBe("renamed.mp4");
    expect(second.lastModified).toBe(42);
    expect(Buffer.from(await second.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
  });

  it("aborts and removes a truncated hydration, then retries from the beginning", async () => {
    const bytes = new Uint8Array(chunk + 2).fill(7);
    const { read, abort, removeEntry } = setup(bytes);
    read.mockImplementationOnce(async (_id, offset, length) =>
      bytes.slice(offset, offset + length - 1),
    );
    const ref = reference("22222222-2222-4222-8222-222222222222", bytes.length);
    await expect(nativeFile(ref)).rejects.toThrow("truncated");
    expect(abort).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith(ref.id);
    expect(
      Buffer.from(await (await nativeFile(ref)).arrayBuffer()).equals(Buffer.from(bytes)),
    ).toBe(true);
    expect(read.mock.calls.map(([, offset]) => offset)).toEqual([0, 0, chunk]);
  });

  it("uses legacy whole-file storage when range methods are unavailable", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { bridge } = setup(bytes);
    delete (bridge as Partial<typeof bridge>).storageFileRead;
    delete (bridge as Partial<typeof bridge>).storageFileSize;
    const storage = await DurableStorage.open();
    const result = await storage.getBlob("legacy-id", "audio/mp4", "old.m4a", 17);
    expect(result).toBeInstanceOf(File);
    expect(result.type).toBe("audio/mp4");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(bridge.storageGetFile).toHaveBeenCalledWith("legacy-id");
  });
});
