import { expect, it } from "vite-plus/test";
import { MiB, UploadError, planUpload, uploadToCloud, type UploadClient } from "./upload";

// Records every protocol call in order. Each method pushes one entry.
function fakeClient(log: string[]): UploadClient {
  return {
    async createItem() {
      log.push("createItem");
      return "media_1";
    },
    async begin() {
      log.push("begin");
      return "version_1";
    },
    async start() {
      log.push("start");
    },
    async partUrl({ part }) {
      log.push(`partUrl:${part}`);
      return { url: `https://r2.test/part/${part}` };
    },
    async complete() {
      log.push("complete");
    },
  };
}

// Records each PUT and the body size it received. `failPart` answers that part with HTTP 500.
function fakeFetch(log: string[], sizes: number[], failPart = 0) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const part = Number(String(url).split("/").at(-1));
    log.push(`PUT:${part}`);
    const body = init?.body;
    if (!(body instanceof Blob)) throw new Error("PUT body must be a Blob");
    sizes.push(body.size);
    return new Response(null, { status: part === failPart ? 500 : 200 });
  }) as typeof fetch;
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

it("splits a 20 MiB file into 8, 8 and 4 MiB parts and calls the protocol in order", async () => {
  const log: string[] = [];
  const sizes: number[] = [];
  const file = new Blob([new Uint8Array(20 * MiB)], { type: "video/webm" });

  const result = await uploadToCloud({
    file,
    name: "  Demo clip  ",
    teamId: "team_1",
    client: fakeClient(log),
    fetchImpl: fakeFetch(log, sizes),
  });

  expect(result).toEqual({ mediaId: "media_1", versionId: "version_1" });
  expect(log).toEqual([
    "createItem",
    "begin",
    "start",
    "partUrl:1",
    "PUT:1",
    "partUrl:2",
    "PUT:2",
    "partUrl:3",
    "PUT:3",
    "complete",
  ]);
  expect(sizes).toEqual([8 * MiB, 8 * MiB, 4 * MiB]);
});

it("sends the trimmed name, the byte total and a request id to begin", async () => {
  const begins: Array<Parameters<UploadClient["begin"]>[0]> = [];
  const client: UploadClient = {
    ...fakeClient([]),
    async begin(args) {
      begins.push(args);
      return "version_1";
    },
  };

  await uploadToCloud({
    file: new Blob([new Uint8Array(100)], { type: "video/webm" }),
    name: "  Demo clip  ",
    teamId: "team_1",
    client,
    fetchImpl: fakeFetch([], []),
  });

  expect(begins).toHaveLength(1);
  const begin = begins[0];
  if (!begin) throw new Error("begin was not called");
  expect(begin).toMatchObject({
    mediaId: "media_1",
    expectedBytes: 100,
    partCount: 1,
  });
  expect(begin.requestId.length).toBeGreaterThan(0);
  expect(JSON.parse(begin.snapshot)).toEqual({
    kind: "upload",
    name: "Demo clip",
    mimeType: "video/webm",
    bytes: 100,
  });
});

it("reports progress after each part, starting from zero", async () => {
  const progress: number[] = [];
  await uploadToCloud({
    file: new Blob([new Uint8Array(20 * MiB)]),
    name: "clip",
    teamId: "team_1",
    client: fakeClient([]),
    fetchImpl: fakeFetch([], []),
    onProgress: ({ loaded, total }) => {
      expect(total).toBe(20 * MiB);
      progress.push(loaded);
    },
  });
  expect(progress).toEqual([0, 8 * MiB, 16 * MiB, 20 * MiB]);
});

it("skips createItem when uploading a new version of an existing item", async () => {
  const log: string[] = [];
  const begins: string[] = [];
  const client: UploadClient = {
    ...fakeClient(log),
    async begin(args) {
      begins.push(args.mediaId);
      return "version_2";
    },
  };

  const result = await uploadToCloud({
    file: new Blob([new Uint8Array(10)]),
    name: "clip",
    teamId: "team_1",
    mediaId: "media_existing",
    client,
    fetchImpl: fakeFetch(log, []),
  });

  expect(result).toEqual({ mediaId: "media_existing", versionId: "version_2" });
  expect(log).not.toContain("createItem");
  expect(begins).toEqual(["media_existing"]);
});

it("stops without completing when aborted between parts", async () => {
  const log: string[] = [];
  const controller = new AbortController();
  const base = fakeClient(log);
  const client: UploadClient = {
    ...base,
    async partUrl(args) {
      const response = await base.partUrl(args);
      if (args.part === 2) controller.abort();
      return response;
    },
  };

  let caught: unknown;
  try {
    await uploadToCloud({
      file: new Blob([new Uint8Array(20 * MiB)]),
      name: "clip",
      teamId: "team_1",
      client,
      signal: controller.signal,
      fetchImpl: fakeFetch(log, []),
    });
  } catch (error) {
    caught = error;
  }

  expect((caught as Error).name).toBe("AbortError");
  expect(log).toEqual(["createItem", "begin", "start", "partUrl:1", "PUT:1", "partUrl:2"]);
  expect(log).not.toContain("complete");
});

it("fails on a rejected part PUT and never completes", async () => {
  const log: string[] = [];
  const run = uploadToCloud({
    file: new Blob([new Uint8Array(20 * MiB)]),
    name: "clip",
    teamId: "team_1",
    client: fakeClient(log),
    fetchImpl: fakeFetch(log, [], 2),
  });

  await expect(run).rejects.toThrow(UploadError);
  await expect(run).rejects.toThrow(/Part 2/);
  expect(log).not.toContain("PUT:3");
  expect(log).not.toContain("complete");
});
