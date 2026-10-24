import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { SQLiteRepository } from "@sidecut/core/sqlite";
import { decodeStorageRequest } from "@sidecut/contracts/storage";

const sqlite = sqlite3InitModule();
let pool: Awaited<ReturnType<Awaited<typeof sqlite>["installOpfsSAHPoolVfs"]>> | undefined;

globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (
    !message ||
    typeof message !== "object" ||
    !("id" in message) ||
    typeof message.id !== "number" ||
    !("request" in message)
  )
    return;
  const id = message.id;
  try {
    const request = decodeStorageRequest(message.request);
    const result = await navigator.locks.request("sidecut:sqlite", async () => {
      const api = await sqlite;
      if (!pool)
        pool = await api.installOpfsSAHPoolVfs({
          name: "sidecut-pool",
          directory: "/sidecut-sqlite",
          initialCapacity: 6,
          preserveOnInitFailure: true,
        });
      else await pool.unpauseVfs();
      try {
        const db = new pool.OpfsSAHPoolDb("/sidecut.sqlite");
        try {
          db.exec("PRAGMA synchronous=FULL");
          const repository = new SQLiteRepository({
            exec: (sql, values) => {
              if (values) db.exec({ sql, bind: [...values] });
              else db.exec(sql);
            },
            rows: (sql, values) => db.selectObjects(sql, [...values]),
          });
          return repository.request(request);
        } finally {
          db.close();
        }
      } finally {
        pool.pauseVfs();
      }
    });
    globalThis.postMessage({ id, result });
  } catch (error) {
    globalThis.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
