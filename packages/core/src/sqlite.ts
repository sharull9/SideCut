import { decodeStorageRows, type StorageRequest } from "@sidecut/contracts/storage";

export interface SQLiteDriver {
  exec(sql: string, values?: readonly (string | null)[]): void;
  rows(sql: string, values: readonly (string | null)[]): unknown;
}

// The same schema and transaction rules run in Electron and the browser worker.
export class SQLiteRepository {
  constructor(private readonly db: SQLiteDriver) {
    const version = decodeStorageRows(
      db.rows(
        "SELECT 'version' AS key, CAST(user_version AS TEXT) AS value FROM pragma_user_version",
        [],
      ),
    )[0]?.value;
    if (version !== "0" && version !== "1")
      throw new Error("This database needs a newer SideCut version.");
    db.exec(
      "CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection,key)); PRAGMA user_version=1;",
    );
  }

  request(request: StorageRequest) {
    const db = this.db;
    if (request.type === "read")
      return decodeStorageRows(
        db.rows(
          `SELECT key,value FROM documents WHERE collection=?${request.key === undefined ? " ORDER BY key" : " AND key=?"}`,
          request.key === undefined ? [request.collection] : [request.collection, request.key],
        ),
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const check of request.checks) {
        const actual =
          this.request({ type: "read", collection: check.collection, key: check.key })[0]?.value ??
          null;
        if (actual !== check.value)
          throw new Error(
            "Save conflict: stored data changed. Reopen the saved project before retrying.",
          );
      }
      for (const write of request.writes) {
        if (write.value === null)
          db.exec("DELETE FROM documents WHERE collection=? AND key=?", [
            write.collection,
            write.key,
          ]);
        else
          db.exec(
            "INSERT INTO documents(collection,key,value) VALUES(?,?,?) ON CONFLICT(collection,key) DO UPDATE SET value=excluded.value",
            [write.collection, write.key, write.value],
          );
      }
      db.exec("COMMIT");
      return [];
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
