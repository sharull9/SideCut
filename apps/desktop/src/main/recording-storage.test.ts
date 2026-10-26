import { describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm, readFile, readdir, open, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RecordingStore, type RecordingStorage } from "@sidecut/core/recordings";
import { NativeStorage } from "./sqlite-storage";
import { exportSavedRecording } from "./recording-output";

const entry = () => ({
  id: randomUUID(),
  projectID: "project",
  createdAt: new Date().toISOString(),
  type: "video/webm;codecs=vp8,opus" as const,
});
describe("durable recording chunks", () => {
  it("survives restart with a committed prefix and removes an uncommitted chunk after a quota failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-recording-store-"));
    let storage = new NativeStorage(root);
    try {
      const backing: RecordingStorage = {
        request: (value) => {
          if (fail && value.type === "commit") throw new Error("Disk full");
          return storage.request(value);
        },
        putFile: (bytes) => storage.putFile(bytes),
        getFile: (id) => storage.getFile(id),
        removeFile: (id) => storage.removeFile(id),
      };
      let fail = false;
      const store = new RecordingStore(backing),
        item = await store.create(entry());
      await store.append(item.id, new Uint8Array([1, 2, 3]));
      fail = true;
      await expect(store.append(item.id, new Uint8Array([4, 5]))).rejects.toThrow("Disk full");
      expect(await readdir(join(root, "storage-files"))).toHaveLength(1);
      storage.close();
      storage = new NativeStorage(root);
      const reopened = new RecordingStore(storage);
      const empty = await reopened.create(entry());
      await reopened.seal(empty.id, "interrupted");
      await expect(reopened.chunks(empty.id).next()).rejects.toThrow("no committed");
      await reopened.remove(empty.id);
      expect((await reopened.get(item.id)).bytes).toBe(3);
      await expect(reopened.remove(item.id)).rejects.toThrow("recover");
      await reopened.seal(item.id, "interrupted");
      const chunks = [];
      for await (const bytes of reopened.chunks(item.id)) chunks.push(...bytes);
      expect(chunks).toEqual([1, 2, 3]);
      await expect(reopened.seal(item.id, "ready")).rejects.toThrow("validation");
      await reopened.remove(item.id);
      expect(await reopened.list()).toEqual([]);
    } finally {
      storage.close();
      expect(root.startsWith(join(tmpdir(), "sidecut-recording-store-"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("streams a real 260 MiB recording through SQLite-backed chunks and refuses output overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-recording-store-"));
    const storage = new NativeStorage(root),
      store = new RecordingStore(storage);
    try {
      const item = await store.create(entry());
      const chunk = new Uint8Array(4 * 1024 * 1024).fill(37);
      for (let index = 0; index < 65; index++) await store.append(item.id, chunk);
      await store.seal(item.id, "ready");
      const output = join(root, "output ü");
      await mkdir(output);
      const result = await exportSavedRecording(
        store,
        item.id,
        output,
        new AbortController().signal,
      );
      expect(result.bytes).toBe(260 * 1024 * 1024);
      const handle = await open(join(output, result.name), "r");
      try {
        expect((await handle.stat()).size).toBe(result.bytes);
        const tail = new Uint8Array(16);
        await handle.read(tail, 0, tail.length, result.bytes - tail.length);
        expect([...tail]).toEqual(Array(16).fill(37));
      } finally {
        await handle.close();
      }
      await expect(
        exportSavedRecording(store, item.id, output, new AbortController().signal),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readdir(output)).toEqual([result.name]);
      expect((await store.get(item.id)).bytes).toBe(result.bytes);
    } finally {
      storage.close();
      expect(root.startsWith(join(tmpdir(), "sidecut-recording-store-"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
  it("retains source chunks on failed/cancelled output and rejects damaged chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-recording-store-"));
    const storage = new NativeStorage(root),
      store = new RecordingStore(storage);
    try {
      const item = await store.create(entry());
      await store.append(item.id, new Uint8Array([7, 8, 9]));
      await store.seal(item.id, "ready");
      const signal = new AbortController();
      signal.abort();
      await expect(exportSavedRecording(store, item.id, root, signal.signal)).rejects.toThrow();
      const output = join(root, "destination");
      await mkdir(output);
      const saved = await store.get(item.id),
        chunk = saved.chunks[0];
      if (!chunk) throw new Error("Missing fixture chunk");
      const handle = await open(join(root, "storage-files", chunk.id), "w");
      await handle.close();
      await expect(
        exportSavedRecording(store, item.id, output, new AbortController().signal),
      ).rejects.toThrow("truncated");
      expect(await readdir(output)).toEqual([]);
      expect((await store.list()).length).toBe(1);
      expect((await readFile(join(root, "storage-files", chunk.id))).length).toBe(0);
    } finally {
      storage.close();
      expect(root.startsWith(join(tmpdir(), "sidecut-recording-store-"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    }
  });
});
