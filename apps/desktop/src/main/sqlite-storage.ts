import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SQLiteRepository } from "@sidecut/core/sqlite";
import { decodeStorageRequest } from "@sidecut/contracts/storage";

export function openSQLite(path: string) {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    const repository = new SQLiteRepository({
      exec: (sql, values) => {
        if (values) database.prepare(sql).run(...values);
        else database.exec(sql);
      },
      rows: (sql, values) => database.prepare(sql).all(...values),
    });
    return { database, repository };
  } catch (error) {
    database.close();
    throw error;
  }
}

export class NativeStorage {
  private readonly connection: ReturnType<typeof openSQLite>;
  constructor(private readonly directory: string) {
    this.connection = openSQLite(join(directory, "sidecut.sqlite"));
  }
  request(value: unknown) {
    const request = decodeStorageRequest(value);
    const entries = request.type === "read" ? [request] : [...request.checks, ...request.writes];
    // Host project snapshots are writable only through validated editor commands.
    if (
      entries.some(
        (e) =>
          e.collection === "projects" ||
          e.collection === "previous" ||
          (e.collection === "migrations" && e.key === "native-project"),
      )
    )
      throw new Error("Host project storage cannot be accessed through the library bridge.");
    return this.connection.repository.request(request);
  }
  async putFile(bytes: unknown) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024 * 1024 * 1024)
      throw new Error("Invalid storage file or file exceeds 1 GiB.");
    const id = randomUUID();
    const directory = join(this.directory, "storage-files");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, id), bytes, { flag: "wx", mode: 0o600, flush: true });
    return id;
  }
  async getFile(id: unknown) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Invalid storage file ID.");
    try {
      return new Uint8Array(await readFile(join(this.directory, "storage-files", id)));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        throw new Error("Stored media file is missing. Relink the source.", { cause: error });
      throw error;
    }
  }
  close() {
    this.connection.database.close();
  }
}
