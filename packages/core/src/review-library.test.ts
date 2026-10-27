/// <reference types="node" />
import { describe, expect, it } from "vite-plus/test";
import empty from "../../../tests/fixtures/tandem/empty.json";
import { ReviewStore, type ReviewStorage } from "./review-library";
import type { StorageRequest } from "@sidecut/contracts/storage";

function storage() {
  const rows = new Map<string, string>(),
    files = new Map<string, Uint8Array>();
  const key = (collection: string, id: string) => `${collection}:${id}`;
  const store: ReviewStorage = {
    request(request: StorageRequest) {
      if (request.type === "read")
        return [...rows]
          .filter(
            ([k]) =>
              k.startsWith(`${request.collection}:`) &&
              (request.key === undefined || k === key(request.collection, request.key)),
          )
          .map(([k, value]) => ({ key: k.slice(request.collection.length + 1), value }));
      for (const check of request.checks)
        if ((rows.get(key(check.collection, check.key)) ?? null) !== check.value)
          throw new Error("Save conflict");
      for (const write of request.writes) {
        const k = key(write.collection, write.key);
        if (write.value === null) rows.delete(k);
        else rows.set(k, write.value);
      }
      return [];
    },
    async putFile(bytes) {
      const id = crypto.randomUUID();
      files.set(id, bytes);
      return id;
    },
    async getFile(id) {
      const bytes = files.get(id);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
    async removeFile(id) {
      files.delete(id);
    },
  };
  return { store, files };
}
describe("review library", () => {
  it("freezes versions, maps anchors and preserves thread history with CAS", async () => {
    const { store } = storage(),
      reviews = new ReviewStore(store);
    const version = await reviews.publish(
      {
        snapshotJSON: JSON.stringify(empty),
        startSeconds: 5,
        durationSeconds: 10,
        createdBy: "Alice",
        title: "Cut",
      },
      new Blob(["video"], { type: "video/webm" }),
      "cut.webm",
    );
    expect(version.projectID).toBe("prj_empty");
    expect(await (await reviews.artifact(version.id)).text()).toBe("video");
    expect((await reviews.listVersions("prj_empty"))[0]).toEqual(version);
    const thread = await reviews.createThread({
      versionID: version.id,
      versionStartSeconds: 2,
      durationSeconds: 1,
      author: "Bob",
      body: "Note",
    });
    expect(thread.anchor.sourceStartSeconds).toBe(7);
    const replied = await reviews.reply(thread.id, 0, { author: "Alice", body: "Done" });
    await expect(
      reviews.resolve(thread.id, 0, { author: "Alice", resolved: true }),
    ).rejects.toThrow("conflict");
    const resolved = await reviews.resolve(thread.id, replied.revision, {
      author: "Alice",
      resolved: true,
    });
    const reopened = await reviews.resolve(thread.id, resolved.revision, {
      author: "Bob",
      resolved: false,
    });
    expect(reopened.replies).toEqual(replied.replies);
    expect(reopened.resolvedAt).toBeNull();
    expect((await reviews.listThreads(version.id))[0]).toEqual(reopened);
    await expect(
      reviews.createThread({
        versionID: version.id,
        versionStartSeconds: 9,
        durationSeconds: 2,
        author: "Bob",
        body: "outside",
      }),
    ).rejects.toThrow();
  });
  it("cleans up a file when publishing metadata fails", async () => {
    const { store, files } = storage();
    store.request = async () => {
      throw new Error("commit failed");
    };
    await expect(
      new ReviewStore(store).publish(
        {
          snapshotJSON: JSON.stringify(empty),
          startSeconds: 0,
          durationSeconds: 1,
          createdBy: "A",
          title: "Cut",
        },
        new Blob(["x"], { type: "video/mp4" }),
        "cut.mp4",
      ),
    ).rejects.toThrow("commit failed");
    expect(files.size).toBe(0);
  });
});

it("uses SQLite CAS to reject concurrent thread edits", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { SQLiteRepository } = await import("./sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    const repo = new SQLiteRepository({
      exec(sql, values) {
        if (values) db.prepare(sql).run(...values);
        else db.exec(sql);
      },
      rows(sql, values) {
        return db.prepare(sql).all(...values);
      },
    });
    const { store } = storage();
    store.request = (request) => repo.request(request);
    const first = new ReviewStore(store),
      second = new ReviewStore(store);
    const version = await first.publish(
      {
        snapshotJSON: JSON.stringify(empty),
        startSeconds: 0,
        durationSeconds: 5,
        createdBy: "A",
        title: "Cut",
      },
      new Blob(["x"], { type: "video/webm" }),
      "cut.webm",
    );
    const thread = await first.createThread({
      versionID: version.id,
      versionStartSeconds: 1,
      durationSeconds: 0,
      author: "A",
      body: "Note",
    });
    const results = await Promise.allSettled([
      first.reply(thread.id, 0, { author: "A", body: "One" }),
      second.reply(thread.id, 0, { author: "B", body: "Two" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await second.listThreads(version.id))[0]?.replies).toHaveLength(1);
  } finally {
    db.close();
  }
});
