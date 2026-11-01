import { describe, it, expect } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeStorage, openSQLite } from "./sqlite-storage.ts";
import { NativeProjectStore } from "./project-store.ts";
import { decodeProjectFile } from "@sidecut/contracts/project";
import {
  encodeStored,
  decodeStored,
} from "../../../../packages/platform-browser/src/storage-codec.ts";

describe("SQLite durability and legacy migration", () => {
  it.each(["delete", "wal"])("preserves a newer %s database when refusing access", async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-future-sqlite-"));
    const path = join(root, "sidecut.sqlite");
    try {
      const fixture = new DatabaseSync(path);
      try {
        fixture.exec(`PRAGMA journal_mode=${mode}; PRAGMA user_version=2;
          CREATE TABLE future_data(value TEXT);
          INSERT INTO future_data VALUES('preserve newer settings and library data');`);
      } finally {
        fixture.close();
      }
      const before = await readFile(path),
        files = (await readdir(root)).sort();
      expect(() => openSQLite(path)).toThrow(/newer raE.E/);
      expect(() => new NativeStorage(root)).toThrow(/newer raE.E/);
      expect(await readFile(path)).toEqual(before);
      expect((await readdir(root)).sort()).toEqual(files);
      const inspect = new DatabaseSync(path, { readOnly: true });
      try {
        expect(inspect.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
        expect(inspect.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(mode);
        expect(inspect.prepare("SELECT value FROM future_data").get()?.value).toBe(
          "preserve newer settings and library data",
        );
        expect(
          inspect
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((row) => row.name),
        ).toEqual(["future_data"]);
      } finally {
        inspect.close();
      }
      const store = new NativeProjectStore(join(root, "current.tandem"));
      try {
        await store.acquire();
        await expect(
          store.load(() => {
            throw new Error("must not create a project");
          }),
        ).rejects.toThrow(/newer raE.E/);
      } finally {
        await store.close();
      }
      expect(await readFile(path)).toEqual(before);
    } finally {
      expect(root.startsWith(join(tmpdir(), "sidecut-future-sqlite-"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back the entire write set after a constraint failure and rejects stale writes", async () => {
    const db = openSQLite(":memory:");
    const { repository, database } = db;
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(database.prepare("PRAGMA synchronous").get()?.synchronous).toBe(2);
    expect(database.prepare("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    const read = () =>
      repository.request({ type: "read", collection: "projects", key: "test" })[0]?.value;
    try {
      repository.request({
        type: "commit",
        checks: [],
        writes: [{ collection: "projects", key: "test", value: "base" }],
      });
      database.exec(
        "CREATE TRIGGER fail_snapshot BEFORE UPDATE ON documents WHEN NEW.collection='projects' BEGIN SELECT RAISE(ABORT,'injected full disk'); END;",
      );
      expect(() =>
        repository.request({
          type: "commit",
          checks: [],
          writes: [
            { collection: "previous", key: "test", value: "base" },
            { collection: "projects", key: "test", value: "new" },
          ],
        }),
      ).toThrow(/injected/);
      expect(read()).toBe("base");
      expect(repository.request({ type: "read", collection: "previous" })).toEqual([]);
      database.exec("DROP TRIGGER fail_snapshot");
      expect(() =>
        repository.request({
          type: "commit",
          checks: [{ collection: "projects", key: "test", value: "stale" }],
          writes: [{ collection: "projects", key: "test", value: "lost" }],
        }),
      ).toThrow(/conflict/);
      expect(read()).toBe("base");
    } finally {
      database.close();
    }
  });

  it("imports JSON once, keeps originals intact, and persists newer edits after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-sqlite-"));
    const path = join(root, "current.tandem");
    const legacy = JSON.stringify({ revision: 0, project: { id: "legacy", name: "Legacy" } });
    await writeFile(path, legacy);
    await writeFile(path + ".bak", legacy);
    const store = new NativeProjectStore(path);
    try {
      await store.acquire();
      const file = await store.load(() => {
        throw new Error("must import");
      });
      expect(file.project.name).toBe("Legacy");
      await store.save({ ...file, project: { ...file.project, name: "SQLite edit" } });
      expect(await readFile(path, "utf8")).toBe(legacy);
      await store.close();
      await writeFile(path, "invalid legacy data must not be imported twice");
      await store.acquire();
      expect(
        (
          await store.load(() => {
            throw new Error("must reopen");
          })
        ).project.name,
      ).toBe("SQLite edit");
      expect((await readFile(store.databasePath)).subarray(0, 16).toString()).toBe(
        "SQLite format 3\0",
      );
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not mark a failed legacy import complete and succeeds after repair", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-sqlite-"));
    const path = join(root, "current.tandem"),
      store = new NativeProjectStore(path);
    try {
      await writeFile(path, "partial");
      await store.acquire();
      await expect(
        store.load(() => decodeProjectFile({ revision: 0, project: { id: "wrong" } })),
      ).rejects.toThrow();
      const db = openSQLite(store.databasePath);
      try {
        expect(db.repository.request({ type: "read", collection: "migrations" })).toEqual([]);
      } finally {
        db.database.close();
      }
      await writeFile(
        path,
        JSON.stringify({ revision: 0, project: { id: "repaired", name: "Repaired" } }),
      );
      expect(
        (
          await store.load(() => {
            throw new Error("must migrate");
          })
        ).project.name,
      ).toBe("Repaired");
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a missing legacy snapshot from its valid backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-sqlite-"));
    const path = join(root, "current.tandem"),
      store = new NativeProjectStore(path);
    try {
      const backup = JSON.stringify({
        revision: 0,
        project: { id: "backup", name: "Recovered backup" },
      });
      await writeFile(path + ".bak", backup);
      await store.acquire();
      const recovered = await store.load(() => {
        throw new Error("Must recover backup");
      });
      expect(recovered.project.name).toBe("Recovered backup");
      expect(recovered.sidecutRecovery).toContain("Recovered");
      expect(await readFile(path + ".bak", "utf8")).toBe(backup);
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves File metadata, nested bytes, and user objects without exposing host snapshots or paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-sqlite-")),
      storage = new NativeStorage(root);
    try {
      const value = {
        file: new File(["hello"], "资料 clip.wav", { type: "audio/wav", lastModified: 123 }),
        samples: new Float32Array([0.5, -0.25]),
        user: { kind: "file", id: "not a reference" },
      };
      const fileStorage = {
        putFile: (v: Uint8Array) => storage.putFile(v),
        getFile: (id: string) => storage.getFile(id),
      };
      const encoded = await encodeStored(value, fileStorage);
      const decoded = await decodeStored(encoded, fileStorage);
      expect(decoded).toEqual(value);
      expect(
        decoded &&
          typeof decoded === "object" &&
          "file" in decoded &&
          decoded.file instanceof File &&
          (await decoded.file.text()),
      ).toBe("hello");
      expect(() => storage.request({ type: "read", collection: "projects" })).toThrow(
        /Host project/,
      );
      expect(() => storage.request({ type: "sql", sql: "DROP TABLE documents" })).toThrow();
      await expect(storage.getFile("../credentials")).rejects.toThrow(/Invalid/);
      await expect(storage.getFile("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        /Stored media file is missing/,
      );
    } finally {
      storage.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("streams files larger than 256 MiB, seals them, and aborts failed writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-storage-"));
  const storage = new NativeStorage(root);
  try {
    const id = await storage.begin();
    const chunk = new Uint8Array(4 * 1024 * 1024);
    chunk[0] = 42;
    for (let i = 0; i < 65; i++) await storage.append(id, chunk);
    await expect(storage.size(id)).rejects.toThrow();
    await storage.seal(id);
    expect(await storage.size(id)).toBe(65 * chunk.length);
    expect((await storage.readRange(id, 64 * chunk.length, 1))[0]).toBe(42);
    await expect(storage.readRange(id, 0, chunk.length + 1)).rejects.toThrow();
    const abandoned = await storage.begin();
    await expect(storage.append(abandoned, new Uint8Array(chunk.length + 1))).rejects.toThrow();
    await storage.abort(abandoned);
    await expect(storage.size(abandoned)).rejects.toThrow();
  } finally {
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
