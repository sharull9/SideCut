import { it, expect, vi, beforeEach } from "vite-plus/test";
import { acquireProjectWriter } from "./writer-lock";
import type * as WriterLock from "./writer-lock";
vi.mock("./writer-lock", () => ({ acquireProjectWriter: vi.fn() }));
beforeEach(() => {
  vi.mocked(acquireProjectWriter).mockResolvedValue(() => {});
});
import { ExportQueue } from "./export-queue";
it("serializes exports, cancels queued work and retains completed downloads until removal", async () => {
  const queue = new ExportQueue();
  let finish!: (blob: Blob) => void;
  const first = queue.enqueue(
    "first.webm",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let ran = false;
  const second = queue.enqueue("second.webm", async () => {
    ran = true;
    return new Blob(["second"]);
  });
  expect(queue.getSnapshot().map((e) => e.status)).toEqual(["running", "queued"]);
  queue.cancel(second);
  finish(new Blob(["first"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ran).toBe(false);
  expect(queue.getSnapshot()).toMatchObject([
    { status: "done", bytes: 5 },
    { status: "cancelled" },
  ]);
  queue.remove(first);
  expect(queue.getSnapshot()).toHaveLength(1);
  queue.clear();
  expect(queue.getSnapshot()).toHaveLength(0);
});
it("reports failures and interrupts a running export without retaining its output", async () => {
  const queue = new ExportQueue();
  queue.enqueue("failed", async () => {
    throw new Error("Missing source");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.getSnapshot()[0]).toMatchObject({ status: "failed", error: "Missing source" });
  const id = queue.enqueue(
    "cancel",
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Stopped"))),
      ),
  );
  queue.cancel(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.getSnapshot()[1]).toMatchObject({ status: "cancelled" });
  queue.clear();
});

it("retries failed work from the beginning and exposes its frozen context and output", async () => {
  const queue = new ExportQueue();
  let attempts = 0;
  const context = { snapshotJSON: "snapshot", startSeconds: 2, durationSeconds: 3 };
  const id = queue.enqueue(
    "retry.webm",
    async () => {
      if (++attempts === 1) throw new Error("failed");
      return new Blob(["ok"]);
    },
    "webm",
    context,
  );
  context.startSeconds = 99;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.getContext(id)?.startSeconds).toBe(2);
  queue.retry(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(attempts).toBe(2);
  expect(queue.getSnapshot()[0]?.status).toBe("done");
  expect(await queue.getOutput(id)?.text()).toBe("ok");
  queue.remove(id);
  expect(queue.getContext(id)).toBeUndefined();
  expect(queue.getOutput(id)).toBeUndefined();
});
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { DeliveryStore } from "@sidecut/core/delivery-store";
import type { StorageRequest } from "@sidecut/contracts/storage";

it("recovers interrupted recipes and completed output from a shared journal", async () => {
  const rows = new Map<string, string>(),
    files = new Map<string, Blob>();
  const storage = {
    async request(request: StorageRequest) {
      if (request.type === "read")
        return [...rows]
          .filter(([key]) => request.key === undefined || request.key === key)
          .map(([key, value]) => ({ key, value }));
      for (const check of request.checks)
        if ((rows.get(check.key) ?? null) !== check.value) throw new Error("conflict");
      for (const write of request.writes)
        if (write.value === null) rows.delete(write.key);
        else rows.set(write.key, write.value);
      return [];
    },
    async putBlob(blob: Blob) {
      const id = crypto.randomUUID();
      files.set(id, blob);
      return id;
    },
    async getBlob(id: string) {
      const blob = files.get(id);
      if (!blob) throw new Error("missing");
      return blob;
    },
    async removeFile(id: string) {
      files.delete(id);
    },
  };
  const file = decodeProjectFile({ revision: 0, project: { id: "prj_test", name: "Frozen" } });
  const recipe = {
    projectID: file.project.id,
    snapshotJSON: encodeProjectFile(file),
    revision: 0,
    resourceIDs: [],
    resources: [],
    preset: "webm" as const,
    format: null,
    startSeconds: 0,
    durationSeconds: 1,
  };
  let release!: (blob: Blob) => void;
  const first = new ExportQueue();
  await first.configure({
    ...storage,
    store: new DeliveryStore(storage),
    run: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const id = first.enqueue(
    "test.webm",
    async () => new Blob(),
    "webm",
    recipe,
    Promise.resolve(recipe),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((await new DeliveryStore(storage).list())[0]?.status).toBe("running");
  const second = new ExportQueue();
  await second.configure({
    ...storage,
    store: new DeliveryStore(storage),
    run: async (saved) => new Blob([saved.snapshotJSON], { type: "video/webm" }),
  });
  expect(second.getSnapshot()[0]?.status).toBe("interrupted");
  second.retry(id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(second.getSnapshot()[0]?.status).toBe("done");
  const third = new ExportQueue();
  await third.configure({
    ...storage,
    store: new DeliveryStore(storage),
    run: async () => {
      throw new Error("must not run");
    },
  });
  expect(third.getSnapshot()[0]).toMatchObject({ status: "done" });
  expect(await third.getOutput(id)?.text()).toBe(recipe.snapshotJSON);
  release(new Blob(["stale"]));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await new DeliveryStore(storage).list())[0]?.status).toBe("done");
});

function durableFixture() {
  const rows = new Map<string, string>(),
    files = new Map<string, Blob>();
  const storage = {
    async request(request: StorageRequest) {
      if (request.type === "read")
        return [...rows]
          .filter(([key]) => request.key === undefined || request.key === key)
          .map(([key, value]) => ({ key, value }));
      for (const check of request.checks)
        if ((rows.get(check.key) ?? null) !== check.value) throw new Error("conflict");
      for (const write of request.writes)
        if (write.value === null) rows.delete(write.key);
        else rows.set(write.key, write.value);
      return [];
    },
    async putBlob(blob: Blob) {
      const id = crypto.randomUUID();
      files.set(id, blob);
      return id;
    },
    async getBlob(id: string) {
      const blob = files.get(id);
      if (!blob) throw new Error("missing");
      return blob;
    },
    async removeFile(id: string) {
      files.delete(id);
    },
  };
  const file = decodeProjectFile({ revision: 0, project: { id: "prj_test", name: "Frozen" } });
  const recipe = {
    projectID: file.project.id,
    snapshotJSON: encodeProjectFile(file),
    revision: 0,
    resourceIDs: ["source"],
    resources: [
      {
        id: "source",
        fileID: "owned",
        name: "source",
        type: "video/webm",
        lastModified: 0,
        state: "available" as const,
        detail: "",
      },
    ],
    preset: "webm" as const,
    format: null,
    startSeconds: 0,
    durationSeconds: 1,
  };
  files.set("owned", new Blob(["source"]));
  return { storage, store: new DeliveryStore(storage), files, recipe };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

it("reconfigures a stopped queue with the new storage in a host without Web Locks", async () => {
  vi.stubGlobal("navigator", undefined);
  try {
    const first = durableFixture();
    const second = durableFixture();
    const queue = new ExportQueue();
    await queue.configure({
      ...first.storage,
      store: first.store,
      run: async () => new Blob(["old"]),
    });
    queue.stop();
    await queue.configure({
      ...second.storage,
      store: second.store,
      run: async () => new Blob(["new"]),
    });
    queue.enqueue(
      "new.webm",
      async () => new Blob(),
      "webm",
      second.recipe,
      Promise.resolve(second.recipe),
    );
    await vi.waitFor(() => expect(queue.getSnapshot()[0]?.status).toBe("done"));
    expect(await first.store.list()).toHaveLength(0);
    expect(await second.store.list()).toMatchObject([{ status: "done" }]);
    queue.clear();
    queue.stop();
    await tick();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("removes a recipe after staging finishes without resurrecting its journal or files", async () => {
  const { storage, store, files, recipe } = durableFixture();
  const queue = new ExportQueue();
  await queue.configure({ ...storage, store, run: async () => new Blob() });
  let stage!: (value: typeof recipe) => void;
  const id = queue.enqueue(
    "staging",
    async () => new Blob(),
    undefined,
    undefined,
    new Promise((resolve) => {
      stage = resolve;
    }),
  );
  queue.remove(id);
  stage(recipe);
  await tick();
  expect(await store.list()).toEqual([]);
  expect(files.size).toBe(0);
  expect(queue.getSnapshot()).toEqual([]);
});

it("removes a running recipe and its output even when output storage finishes later", async () => {
  const { storage, store, files, recipe } = durableFixture();
  let finish!: (id: string) => void;
  const queue = new ExportQueue();
  await queue.configure({
    ...storage,
    store,
    putBlob: async (blob) => {
      const id = await storage.putBlob(blob);
      return new Promise((resolve) => {
        finish = () => resolve(id);
      });
    },
    run: async () => new Blob(["output"]),
  });
  const id = queue.enqueue(
    "running",
    async () => new Blob(),
    undefined,
    undefined,
    Promise.resolve(recipe),
  );
  await tick();
  queue.remove(id);
  finish("");
  await tick();
  expect(await store.list()).toEqual([]);
  expect(files.size).toBe(0);
});

it("persists queued cancellation during staging and can retry it", async () => {
  const { storage, store, recipe } = durableFixture();
  const queue = new ExportQueue();
  await queue.configure({ ...storage, store, run: async () => new Blob(["output"]) });
  let stage!: (value: typeof recipe) => void;
  const id = queue.enqueue(
    "cancel",
    async () => new Blob(),
    undefined,
    undefined,
    new Promise((resolve) => {
      stage = resolve;
    }),
  );
  queue.cancel(id);
  stage(recipe);
  await tick();
  expect((await store.list())[0]?.status).toBe("cancelled");
  queue.retry(id);
  await tick();
  expect((await store.list())[0]?.status).toBe("done");
  queue.remove(id);
});

it("recovers a stored final output from an interrupted journal without rendering", async () => {
  const { storage, store, recipe } = durableFixture();
  const outputFileID = await storage.putBlob(new Blob(["complete"], { type: "video/webm" }));
  const id = crypto.randomUUID();
  await store.put(
    {
      id,
      name: "recovered",
      recipe,
      status: "running",
      error: null,
      outputFileID,
      outputType: "video/webm",
    },
    null,
  );
  const queue = new ExportQueue();
  await queue.configure({
    ...storage,
    store,
    run: async () => {
      throw new Error("must not render");
    },
  });
  expect(queue.getSnapshot()[0]?.status).toBe("done");
  expect(await queue.getOutput(id)?.text()).toBe("complete");
  expect((await store.list())[0]?.status).toBe("done");
  queue.remove(id);
});

it("retries immediately while a cancelled recipe is still staging", async () => {
  const { storage, store, recipe } = durableFixture();
  const queue = new ExportQueue();
  let runs = 0;
  await queue.configure({
    ...storage,
    store,
    run: async () => {
      runs++;
      return new Blob(["output"]);
    },
  });
  let stage!: (value: typeof recipe) => void;
  const id = queue.enqueue(
    "retry",
    async () => new Blob(),
    undefined,
    undefined,
    new Promise((resolve) => {
      stage = resolve;
    }),
  );
  queue.cancel(id);
  queue.retry(id);
  stage(recipe);
  await tick();
  expect(runs).toBe(1);
  expect((await store.list())[0]?.status).toBe("done");
  queue.remove(id);
});

it("keeps another window from interrupting a live queue and releases ownership after shutdown", async () => {
  const real = await vi.importActual<typeof WriterLock>("./writer-lock");
  vi.mocked(acquireProjectWriter).mockImplementation(real.acquireProjectWriter);
  const { storage, store, recipe } = durableFixture();
  const first = new ExportQueue(),
    second = new ExportQueue();
  let finish!: (blob: Blob) => void;
  try {
    await first.configure({
      ...storage,
      store,
      run: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    first.enqueue("owned", async () => new Blob(), undefined, undefined, Promise.resolve(recipe));
    await tick();
    await second.configure({ ...storage, store, run: async () => new Blob() });
    expect((await store.list())[0]?.status).toBe("running");
    expect(() => second.assertAvailable()).toThrow("another window");
    first.stop();
    // Cancellation must retain ownership until the encoder actually settles.
    await second.configure({ ...storage, store, run: async () => new Blob() });
    expect(() => second.assertAvailable()).toThrow("another window");
    finish(new Blob());
    await tick();
    await second.configure({ ...storage, store, run: async () => new Blob() });
    expect(() => second.assertAvailable()).not.toThrow();
    expect(second.getSnapshot()[0]?.status).toBe("interrupted");
  } finally {
    first.stop();
    second.stop();
  }
});

it("releases the delivery lock when stopped during lock acquisition", async () => {
  const release = vi.fn();
  let grant!: (value: () => void) => void;
  vi.mocked(acquireProjectWriter).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const { storage, store } = durableFixture();
  const queue = new ExportQueue();
  const configuring = queue.configure({ ...storage, store, run: async () => new Blob() });
  queue.stop();
  expect(() => queue.assertAvailable()).toThrow("closing");
  grant(release);
  await configuring;
  expect(release).toHaveBeenCalledTimes(1);
  expect(queue.getSnapshot()).toEqual([]);
});

it("keeps the lock until recovery finishes when stopped during recovery", async () => {
  const release = vi.fn();
  vi.mocked(acquireProjectWriter).mockResolvedValueOnce(release);
  const { storage, store, recipe } = durableFixture();
  const id = crypto.randomUUID();
  await store.put(
    { id, name: "q", recipe, status: "queued", error: null, outputFileID: null, outputType: null },
    null,
  );
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const queue = new ExportQueue();
  let renders = 0;
  const configuring = queue.configure({
    ...storage,
    store: Object.assign(Object.create(store), {
      interruptRunning: async () => {
        await gate;
        return store.interruptRunning();
      },
    }),
    run: async () => {
      renders++;
      return new Blob();
    },
  });
  await tick();
  queue.stop();
  expect(release).not.toHaveBeenCalled();
  finish();
  await configuring;
  await tick();
  expect(release).toHaveBeenCalledTimes(1);
  expect(renders).toBe(0);
});

it("does not let a second configure call acquire the lock twice", async () => {
  const { storage, store } = durableFixture();
  const queue = new ExportQueue();
  vi.mocked(acquireProjectWriter).mockClear();
  const options = { ...storage, store, run: async () => new Blob() };
  await Promise.all([queue.configure(options), queue.configure(options)]);
  expect(acquireProjectWriter).toHaveBeenCalledTimes(1);
  expect(() => queue.assertAvailable()).not.toThrow();
  queue.stop();
});

it("cancelling during output commit leaves no journal output or stored file", async () => {
  const { storage, store, files, recipe } = durableFixture();
  let release!: () => void;
  const queue = new ExportQueue();
  await queue.configure({
    ...storage,
    store,
    putBlob: async (blob) => {
      const fileID = await storage.putBlob(blob);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return fileID;
    },
    run: async () => new Blob(["output"]),
  });
  const id = queue.enqueue(
    "commit",
    async () => new Blob(),
    undefined,
    undefined,
    Promise.resolve(recipe),
  );
  await tick();
  expect(queue.getSnapshot()[0]?.status).toBe("running");
  queue.cancel(id);
  expect(queue.getSnapshot()[0]?.status).toBe("running"); // cancelling still drains
  release();
  await tick();
  expect(queue.getSnapshot()[0]?.status).toBe("cancelled");
  expect(queue.getOutput(id)).toBeUndefined();
  expect((await store.list())[0]?.status).toBe("cancelled");
  expect([...files.keys()]).toEqual(["owned"]);
  queue.remove(id);
});

it("an old attempt's late completion cannot settle a retried attempt", async () => {
  const queue = new ExportQueue();
  const finishes: ((blob: Blob) => void)[] = [];
  const id = queue.enqueue(
    "retry",
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  queue.cancel(id);
  finishes[0]!(new Blob(["old"]));
  await tick();
  expect(queue.getSnapshot()[0]?.status).toBe("cancelled");
  queue.retry(id);
  await tick();
  expect(queue.getSnapshot()[0]?.status).toBe("running");
  finishes[1]!(new Blob(["new"]));
  await tick();
  expect(queue.getSnapshot()[0]).toMatchObject({ status: "done", bytes: 3 });
  queue.clear();
});
