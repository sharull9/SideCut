import { expect, it } from "vite-plus/test";
import {
  MiB,
  UploadError,
  UploadHttpError,
  UploadPausedError,
  discardPendingUpload,
  hasPendingUpload,
  planUpload,
  uploadToCloud,
  type PutPart,
  type UploadClient,
  type UploadStorage,
} from "./upload";

type BeginArgs = Parameters<UploadClient["beginUpload"]>[0];

// In-memory stand-in for localStorage.
class MemoryStorage implements UploadStorage {
  private readonly items = new Map<string, string>();

  get length() {
    return this.items.size;
  }

  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }

  removeItem(key: string) {
    this.items.delete(key);
  }

  keys() {
    return [...this.items.keys()];
  }
}

// A fake backend and a fake part PUT. Protocol calls are logged in order. Tests tune behaviour through
// `failures` (thrown once on the next PUT of a part), `expire` (URLs of a part answering 403),
// `conflicting` (requestIds the server rejects) and the `onPut` hook (runs before each PUT).
function harness(onPut?: (part: number) => void) {
  const calls: string[] = [];
  const begins: BeginArgs[] = [];
  const aborted: string[] = [];
  const sizes: number[] = [];
  const failures = new Map<number, Error>();
  const expire = new Map<number, number>();
  const conflicting = new Set<string>();
  const byRequest = new Map<string, { mediaId: string; versionId: string }>();
  const urls = new Map<string, { versionId: string; part: number }>();
  const stored = new Map<string, Set<number>>();
  let versionCount = 0;
  let urlCount = 0;

  const client: UploadClient = {
    async beginUpload(args) {
      calls.push("beginUpload");
      begins.push(args);
      if (conflicting.has(args.requestId)) {
        throw new Error("Request conflicts with existing version.");
      }
      let version = byRequest.get(args.requestId);
      if (!version) {
        versionCount += 1;
        version = {
          mediaId: args.mediaId ?? `media_${versionCount}`,
          versionId: `version_${versionCount}`,
        };
        byRequest.set(args.requestId, version);
        stored.set(version.versionId, new Set());
      }
      return version;
    },
    async start() {
      calls.push("start");
    },
    async uploadedParts({ versionId }) {
      calls.push("uploadedParts");
      return { parts: [...(stored.get(versionId) ?? [])] };
    },
    async partUrl({ versionId, part }) {
      calls.push(`partUrl:${part}`);
      urlCount += 1;
      const url = `https://r2.test/${urlCount}`;
      urls.set(url, { versionId, part });
      return { url };
    },
    async complete() {
      calls.push("complete");
    },
    async abort({ versionId }) {
      calls.push("abort");
      aborted.push(versionId);
    },
  };

  const putPart: PutPart = async (url, body, onProgress, signal) => {
    const target = urls.get(url);
    if (!target) throw new Error(`unknown part URL ${url}`);
    const { versionId, part } = target;
    calls.push(`PUT:${part}`);
    sizes.push(body.size);
    onPut?.(part);
    if (signal?.aborted) throw new DOMException("Upload cancelled.", "AbortError");
    // Bytes are reported before the request can fail, the way a real socket behaves.
    onProgress(Math.floor(body.size / 2));
    const expired = expire.get(part) ?? 0;
    if (expired > 0) {
      expire.set(part, expired - 1);
      throw new UploadHttpError(403);
    }
    const failure = failures.get(part);
    if (failure) {
      failures.delete(part);
      throw failure;
    }
    onProgress(body.size);
    stored.get(versionId)?.add(part);
  };

  return { client, putPart, calls, begins, aborted, sizes, failures, expire, conflicting };
}

function twentyMiB() {
  return new Blob([new Uint8Array(20 * MiB)], { type: "video/webm" });
}

it("plans a single part for files up to 8 MiB", () => {
  expect(planUpload(1)).toEqual({ partSize: 8 * MiB, partCount: 1 });
  expect(planUpload(8 * MiB)).toEqual({ partSize: 8 * MiB, partCount: 1 });
});

it("adds a part once a file exceeds 8 MiB", () => {
  expect(planUpload(8 * MiB + 1)).toEqual({ partSize: 8 * MiB, partCount: 2 });
});

it("keeps the part count within the 10000 part limit at the maximum size", () => {
  const plan = planUpload(5e10);
  expect(plan.partSize).toBeGreaterThanOrEqual(8 * MiB);
  expect(plan.partCount).toBeGreaterThan(0);
  expect(plan.partCount).toBeLessThanOrEqual(10_000);
});

it("rejects empty files and files over 50 GB", () => {
  expect(() => planUpload(0)).toThrow(UploadError);
  expect(() => planUpload(0)).toThrow(/non-empty/);
  expect(() => planUpload(5e10 + 1)).toThrow(UploadError);
  expect(() => planUpload(5e10 + 1)).toThrow(/50 GB/);
});

it("uploads a 20 MiB file in 8, 8 and 4 MiB parts and calls the protocol in order", async () => {
  const h = harness();
  const storage = new MemoryStorage();

  const result = await uploadToCloud({
    file: twentyMiB(),
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
  });

  expect(result).toEqual({ mediaId: "media_1", versionId: "version_1" });
  expect(h.calls).toEqual([
    "beginUpload",
    "start",
    "uploadedParts",
    "partUrl:1",
    "PUT:1",
    "partUrl:2",
    "PUT:2",
    "partUrl:3",
    "PUT:3",
    "complete",
  ]);
  expect(h.sizes).toEqual([8 * MiB, 8 * MiB, 4 * MiB]);
  expect(storage.keys()).toEqual([]);
});

it("sends the trimmed name, snapshot, byte total and part count to beginUpload", async () => {
  const h = harness();

  await uploadToCloud({
    file: new Blob([new Uint8Array(100)], { type: "video/webm" }),
    name: "  Demo clip  ",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage: new MemoryStorage(),
  });

  expect(h.begins).toHaveLength(1);
  const begin = h.begins[0];
  if (!begin) throw new Error("beginUpload was not called");
  expect(begin).toMatchObject({
    teamId: "team_1",
    name: "Demo clip",
    fileName: "Demo clip",
    expectedBytes: 100,
    partCount: 1,
  });
  expect(begin).not.toHaveProperty("mediaId");
  expect(begin.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.parse(begin.snapshot)).toEqual({
    kind: "upload",
    name: "Demo clip",
    mimeType: "video/webm",
    bytes: 100,
  });
});

it("passes an existing mediaId through so the upload becomes a new version", async () => {
  const h = harness();

  const result = await uploadToCloud({
    file: new Blob([new Uint8Array(10)]),
    name: "clip",
    teamId: "team_1",
    mediaId: "media_existing",
    client: h.client,
    putPart: h.putPart,
    storage: new MemoryStorage(),
  });

  expect(h.begins[0]).toMatchObject({ mediaId: "media_existing" });
  expect(result).toEqual({ mediaId: "media_existing", versionId: "version_1" });
});

it("resumes after a network failure: same requestId, stored parts skipped, their bytes counted", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  const file = twentyMiB();
  const run = () =>
    uploadToCloud({
      file,
      name: "clip",
      teamId: "team_1",
      client: h.client,
      putPart: h.putPart,
      storage,
      onProgress: ({ loaded }) => progress.push(loaded),
    });
  const progress: number[] = [];

  h.failures.set(2, new TypeError("Network error during upload."));
  await expect(run()).rejects.toThrow(TypeError);
  expect(storage.keys()).toHaveLength(1);

  h.calls.length = 0;
  progress.length = 0;
  const result = await run();

  expect(result).toEqual({ mediaId: "media_1", versionId: "version_1" });
  const [first, second] = h.begins.map((begin) => begin.requestId);
  expect(second).toBe(first);
  expect(h.calls).toEqual([
    "beginUpload",
    "start",
    "uploadedParts",
    "partUrl:2",
    "PUT:2",
    "partUrl:3",
    "PUT:3",
    "complete",
  ]);
  expect(progress[0]).toBe(8 * MiB);
  expect(progress.at(-1)).toBe(20 * MiB);
  expect(storage.keys()).toEqual([]);
});

it("starts over with a fresh requestId when the server rejects the stored one", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  const file = twentyMiB();
  const run = () =>
    uploadToCloud({
      file,
      name: "clip",
      teamId: "team_1",
      client: h.client,
      putPart: h.putPart,
      storage,
    });

  h.failures.set(2, new TypeError("Network error during upload."));
  await expect(run()).rejects.toThrow(TypeError);
  const stale = h.begins[0]?.requestId;
  if (!stale) throw new Error("beginUpload was not called");
  h.conflicting.add(stale);

  h.calls.length = 0;
  const result = await run();

  expect(h.calls.slice(0, 3)).toEqual(["beginUpload", "beginUpload", "start"]);
  const ids = h.begins.map((begin) => begin.requestId);
  expect(ids[1]).toBe(stale);
  expect(ids[2]).toMatch(/^[0-9a-f-]{36}$/);
  expect(ids[2]).not.toBe(stale);
  expect(result.versionId).toBe("version_2");
  expect(storage.keys()).toEqual([]);
});

it("cancels: aborts the server version, clears the record and rejects with AbortError", async () => {
  const controller = new AbortController();
  const h = harness((part) => {
    if (part === 2) controller.abort();
  });
  const storage = new MemoryStorage();

  const error = await uploadToCloud({
    file: twentyMiB(),
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
    cancelSignal: controller.signal,
  }).then(
    () => null,
    (cause: unknown) => cause,
  );

  expect((error as { name?: unknown } | null)?.name).toBe("AbortError");
  expect(error).not.toBeInstanceOf(UploadPausedError);
  expect(h.aborted).toEqual(["version_1"]);
  expect(h.calls).not.toContain("PUT:3");
  expect(h.calls).not.toContain("complete");
  expect(storage.keys()).toEqual([]);
});

it("pauses: stops the PUTs, keeps the record without contacting the server, and resumes later", async () => {
  const controller = new AbortController();
  const h = harness((part) => {
    if (part === 2) controller.abort();
  });
  const storage = new MemoryStorage();
  const file = twentyMiB();

  const error = await uploadToCloud({
    file,
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
    signal: controller.signal,
  }).then(
    () => null,
    (cause: unknown) => cause,
  );

  expect(error).toBeInstanceOf(UploadPausedError);
  expect((error as { name?: unknown }).name).toBe("AbortError");
  expect(h.calls).not.toContain("PUT:3");
  expect(h.calls).not.toContain("complete");
  expect(h.calls).not.toContain("abort");
  expect(h.aborted).toEqual([]);
  expect(storage.keys()).toHaveLength(1);
  expect(hasPendingUpload("team_1", file, storage)).toBe(true);

  h.calls.length = 0;
  const result = await uploadToCloud({
    file,
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
  });

  expect(result).toEqual({ mediaId: "media_1", versionId: "version_1" });
  expect(h.calls).toEqual([
    "beginUpload",
    "start",
    "uploadedParts",
    "partUrl:2",
    "PUT:2",
    "partUrl:3",
    "PUT:3",
    "complete",
  ]);
  expect(storage.keys()).toEqual([]);
});

it("discards a paused upload: aborts the stored version and clears the record", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  const file = twentyMiB();

  h.failures.set(2, new TypeError("Network error during upload."));
  await expect(
    uploadToCloud({
      file,
      name: "clip",
      teamId: "team_1",
      client: h.client,
      putPart: h.putPart,
      storage,
    }),
  ).rejects.toThrow(TypeError);
  expect(hasPendingUpload("team_1", file, storage)).toBe(true);

  // Another team's pending upload is not discarded.
  await discardPendingUpload("team_2", file, h.client, storage);
  expect(h.aborted).toEqual([]);
  expect(storage.keys()).toHaveLength(1);

  await discardPendingUpload("team_1", file, h.client, storage);
  expect(h.aborted).toEqual(["version_1"]);
  expect(storage.keys()).toEqual([]);
  expect(hasPendingUpload("team_1", file, storage)).toBe(false);
});

it("discard still clears the record when the server abort fails", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  const file = twentyMiB();

  h.failures.set(2, new TypeError("Network error during upload."));
  await expect(
    uploadToCloud({
      file,
      name: "clip",
      teamId: "team_1",
      client: h.client,
      putPart: h.putPart,
      storage,
    }),
  ).rejects.toThrow(TypeError);

  await discardPendingUpload(
    "team_1",
    file,
    {
      abort: async () => {
        throw new Error("Server unavailable.");
      },
    },
    storage,
  );

  expect(storage.keys()).toEqual([]);
  expect(hasPendingUpload("team_1", file, storage)).toBe(false);
});

it("keeps the resume record and does not abort the version after a network failure", async () => {
  const h = harness();
  const storage = new MemoryStorage();

  h.failures.set(1, new TypeError("Network error during upload."));
  await expect(
    uploadToCloud({
      file: twentyMiB(),
      name: "clip",
      teamId: "team_1",
      client: h.client,
      putPart: h.putPart,
      storage,
    }),
  ).rejects.toThrow(TypeError);

  expect(storage.keys()).toHaveLength(1);
  expect(h.aborted).toEqual([]);
  expect(h.calls).not.toContain("abort");
});

it("reports progress that never moves back and ends at the total, across a retried part", async () => {
  const h = harness();
  h.expire.set(2, 1);
  const progress: number[] = [];

  await uploadToCloud({
    file: twentyMiB(),
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage: new MemoryStorage(),
    onProgress: ({ loaded, total }) => {
      expect(total).toBe(20 * MiB);
      progress.push(loaded);
    },
  });

  expect(progress).toEqual([4 * MiB, 8 * MiB, 12 * MiB, 16 * MiB, 18 * MiB, 20 * MiB]);
});

it("requests a fresh URL and retries once when a part URL has expired (403)", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  h.expire.set(2, 1);

  const result = await uploadToCloud({
    file: twentyMiB(),
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
  });

  expect(result).toEqual({ mediaId: "media_1", versionId: "version_1" });
  expect(h.calls).toEqual([
    "beginUpload",
    "start",
    "uploadedParts",
    "partUrl:1",
    "PUT:1",
    "partUrl:2",
    "PUT:2",
    "partUrl:2",
    "PUT:2",
    "partUrl:3",
    "PUT:3",
    "complete",
  ]);
  expect(storage.keys()).toEqual([]);
});

it("gives up when a part URL keeps expiring after one retry, and keeps the record", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  h.expire.set(2, 5);

  const error = await uploadToCloud({
    file: twentyMiB(),
    name: "clip",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
  }).then(
    () => null,
    (cause: unknown) => cause,
  );

  expect(error).toBeInstanceOf(UploadHttpError);
  expect((error as UploadHttpError).status).toBe(403);
  expect(h.calls.filter((call) => call === "PUT:2")).toHaveLength(2);
  expect(h.calls).not.toContain("PUT:3");
  expect(h.calls).not.toContain("complete");
  expect(storage.keys()).toHaveLength(1);
});

it("rejects an empty file before contacting the server", async () => {
  const h = harness();
  const storage = new MemoryStorage();

  const error = await uploadToCloud({
    file: new Blob([]),
    name: "empty",
    teamId: "team_1",
    client: h.client,
    putPart: h.putPart,
    storage,
  }).then(
    () => null,
    (cause: unknown) => cause,
  );

  expect(error).toBeInstanceOf(UploadError);
  expect((error as UploadError).message).toMatch(/non-empty/);
  expect(h.calls).toEqual([]);
  expect(storage.keys()).toEqual([]);
});

it("reports a pending upload for the same team, size and lastModified until it completes", async () => {
  const h = harness();
  const storage = new MemoryStorage();
  const file = new File([new Uint8Array(100)], "clip.webm", { lastModified: 1000 });
  const run = (target: Blob) =>
    uploadToCloud({
      file: target,
      name: "clip",
      teamId: "team_1",
      client: h.client,
      putPart: h.putPart,
      storage,
    });

  h.failures.set(1, new TypeError("Network error during upload."));
  await expect(run(file)).rejects.toThrow(TypeError);

  expect(hasPendingUpload("team_1", file, storage)).toBe(true);
  expect(hasPendingUpload("team_2", file, storage)).toBe(false);
  expect(
    hasPendingUpload(
      "team_1",
      new File([new Uint8Array(100)], "clip.webm", { lastModified: 2000 }),
      storage,
    ),
  ).toBe(false);

  await run(file);

  expect(hasPendingUpload("team_1", file, storage)).toBe(false);
});
