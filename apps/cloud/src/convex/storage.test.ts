import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import { AbortMultipartUploadCommand, ListPartsCommand, S3Client } from "@aws-sdk/client-s3";
import schema from "./schema";
import * as teams from "./teams";
import * as library from "./library";
import * as versions from "./versions";
import * as storage from "./storage";
import { attachmentDisposition } from "./downloadName";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  teams,
  library,
  versions,
  storage,
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("private R2 action boundary", () => {
  it("fails closed before contacting storage for missing membership or configuration", async () => {
    const t = createTest();
    const a = t.withIdentity({ subject: "alice", issuer: "https://api.workos.com/" });
    const b = t.withIdentity({ subject: "bob", issuer: "https://api.workos.com/" });
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const mediaId = await a.mutation(api.library.create, { teamId, name: "Render" });
    const versionId = await a.mutation(api.versions.begin, {
      mediaId,
      requestId: "one",
      snapshot: "{}",
      expectedBytes: 10,
      partCount: 1,
    });
    vi.stubEnv("R2_ACCOUNT_ID", "");
    const send = vi.spyOn(S3Client.prototype, "send");
    await expect(b.action(api.storage.start, { versionId })).rejects.toThrow("access denied");
    await expect(a.action(api.storage.start, { versionId })).rejects.toThrow("not configured");
    await expect(b.action(api.storage.partUrl, { versionId, part: 1 })).rejects.toThrow(
      "access denied",
    );
    await expect(b.action(api.storage.complete, { versionId })).rejects.toThrow("access denied");
    await expect(b.action(api.storage.playbackUrl, { mediaId })).rejects.toThrow("access denied");
    await expect(b.action(api.storage.sourceUrl, { mediaId })).rejects.toThrow("access denied");
    await expect(a.action(api.storage.sourceUrl, { mediaId })).rejects.toThrow(
      "Source unavailable",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to complete a recording upload before its size is sealed", async () => {
    const t = createTest();
    const a = t.withIdentity({ subject: "alice", issuer: "https://api.workos.com/" });
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const mediaId = await a.mutation(api.library.create, { teamId, name: "Take" });
    const versionId = await a.mutation(api.versions.beginStream, {
      mediaId,
      requestId: "take",
      snapshot: "{}",
    });
    await t.run((ctx) => ctx.db.patch(versionId, { uploadId: "upload" }));
    const send = vi.spyOn(S3Client.prototype, "send");
    await expect(a.action(api.storage.complete, { versionId })).rejects.toThrow("not sealed");
    expect(send).not.toHaveBeenCalled();
  });
});

const alice = { subject: "alice", issuer: "https://api.workos.com/" };
const bob = { subject: "bob", issuer: "https://api.workos.com/" };
const HOUR_MS = 60 * 60 * 1000;

function configureStorage() {
  vi.stubEnv("R2_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("R2_BUCKET", "test-bucket");
}

// Replaces S3 sends so tests can assert which storage commands ran, without network access.
function fakeS3(respond: (command: unknown) => unknown = () => ({})) {
  return vi
    .spyOn(S3Client.prototype, "send")
    .mockImplementation((async (command: unknown) => respond(command)) as never);
}

// Creates one uploading version of a fresh media item with a multipart upload attached.
// Uses beginUpload so the media carries createRequestId and is removed with its only cancelled version.
async function uploading(opts: { attachUpload?: boolean } = {}) {
  configureStorage();
  const t = createTest();
  const a = t.withIdentity(alice);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  const { mediaId, versionId } = await a.mutation(api.versions.beginUpload, {
    teamId,
    name: "Render",
    requestId: "one",
    fileName: "render.mp4",
    snapshot: "{}",
    expectedBytes: 10,
    partCount: 2,
  });
  if (opts.attachUpload !== false)
    await t.run((ctx) => ctx.db.patch(versionId, { uploadId: "upload-1" }));
  return { t, a, b: t.withIdentity(bob), teamId, mediaId, versionId };
}

describe("storage.uploadedParts", () => {
  it("lists stored part numbers in ascending order across pages", async () => {
    const { a, versionId } = await uploading();
    const send = fakeS3((command) => {
      if (!(command instanceof ListPartsCommand)) throw new Error("unexpected command");
      if (command.input.PartNumberMarker === undefined)
        return { Parts: [{ PartNumber: 3 }], IsTruncated: true, NextPartNumberMarker: "3" };
      return { Parts: [{ PartNumber: 1 }], IsTruncated: false };
    });

    await expect(a.action(api.storage.uploadedParts, { versionId })).resolves.toEqual({
      parts: [1, 3],
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns no parts before a multipart upload exists", async () => {
    const { a, versionId } = await uploading({ attachUpload: false });
    const send = fakeS3();

    await expect(a.action(api.storage.uploadedParts, { versionId })).resolves.toEqual({
      parts: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects outsiders before contacting storage", async () => {
    const { b, versionId } = await uploading();
    const send = fakeS3();

    await expect(b.action(api.storage.uploadedParts, { versionId })).rejects.toThrow(
      "access denied",
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("storage.abort", () => {
  it("aborts the multipart upload and cancels the version", async () => {
    const { t, a, mediaId, versionId } = await uploading();
    const send = fakeS3();

    await expect(a.action(api.storage.abort, { versionId })).resolves.toEqual({
      cancelled: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(AbortMultipartUploadCommand);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ input: { UploadId: "upload-1" } });
    // The only version was an orphan, so cancelling it removes the media too.
    expect(await t.run((ctx) => ctx.db.get(mediaId))).toBeNull();
  });

  it("reports false and contacts no storage once the upload is already gone", async () => {
    const { a, versionId } = await uploading();
    const send = fakeS3();
    await a.action(api.storage.abort, { versionId });
    expect(send).toHaveBeenCalledTimes(1);

    // Clear the first abort's call so only the retry's storage traffic is counted.
    send.mockClear();
    await expect(a.action(api.storage.abort, { versionId })).resolves.toEqual({
      cancelled: false,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("only cancels the row when no multipart upload was ever created", async () => {
    const { t, a, mediaId, versionId } = await uploading({ attachUpload: false });
    const send = fakeS3();

    await expect(a.action(api.storage.abort, { versionId })).resolves.toEqual({
      cancelled: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(mediaId))).toBeNull();
  });

  it("rejects outsiders before contacting storage", async () => {
    const { t, b, mediaId, versionId } = await uploading();
    const send = fakeS3();

    await expect(b.action(api.storage.abort, { versionId })).rejects.toThrow("access denied");
    expect(send).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(mediaId))).not.toBeNull();
  });
});

describe("storage.originalUrl", () => {
  // Marks the version as the media's ready original so it can be downloaded.
  async function ready(
    opts: { fileName?: string | undefined; status?: "ready" | "uploading" } = {},
  ) {
    const fixture = await uploading();
    const status = opts.status ?? "ready";
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.versionId, { status, fileName: opts.fileName });
      if (status === "ready")
        await ctx.db.patch(fixture.mediaId, { readyVersionId: fixture.versionId });
    });
    return fixture;
  }

  it("returns a short-lived signed URL with a UTF-8 attachment disposition", async () => {
    const { a, mediaId } = await ready({ fileName: "Café render.mp4" });

    const result = await a.action(api.storage.originalUrl, { mediaId });
    expect(result).toEqual({
      url: expect.any(String),
      fileName: "Café render.mp4",
      expiresIn: 300,
    });
    const url = new URL(result.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      attachmentDisposition("Café render.mp4"),
    );
  });

  it("falls back to the media name and version number when no file name was stored", async () => {
    const { a, mediaId } = await ready({ fileName: undefined });

    const result = await a.action(api.storage.originalUrl, { mediaId });
    expect(result.fileName).toBe("Render-v1");
  });

  it("refuses versions that are not ready or processing", async () => {
    const { a, mediaId, versionId } = await ready({ status: "uploading" });

    await expect(a.action(api.storage.originalUrl, { mediaId, versionId })).rejects.toThrow(
      "Original unavailable.",
    );
  });

  it("refuses archived media before contacting storage", async () => {
    const { t, a, mediaId } = await ready();
    await t.run((ctx) => ctx.db.patch(mediaId, { archived: true }));
    const send = fakeS3();

    await expect(a.action(api.storage.originalUrl, { mediaId })).rejects.toThrow("Media archived.");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects outsiders", async () => {
    const { b, mediaId } = await ready();
    const send = fakeS3();

    await expect(b.action(api.storage.originalUrl, { mediaId })).rejects.toThrow("access denied");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("storage.abortStaleUploads", () => {
  // Moves only the Date clock forward so rows created before the shift look a day old.
  function ageRows(hours: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + hours * HOUR_MS);
  }

  it("aborts stale multipart uploads and leaves fresh ones alone", async () => {
    const { t, a, teamId } = await uploading();
    const stale = await a.mutation(api.versions.begin, {
      mediaId: await a.mutation(api.library.create, { teamId, name: "Old" }),
      requestId: "old",
      snapshot: "{}",
      expectedBytes: 10,
      partCount: 1,
    });
    await t.run((ctx) => ctx.db.patch(stale, { uploadId: "upload-old" }));

    ageRows(25);
    const fresh = await a.mutation(api.versions.begin, {
      mediaId: await a.mutation(api.library.create, { teamId, name: "New" }),
      requestId: "new",
      snapshot: "{}",
      expectedBytes: 10,
      partCount: 1,
    });
    const send = fakeS3();

    await expect(t.action(internal.storage.abortStaleUploads, {})).resolves.toBe(2);
    const uploadIds = send.mock.calls.map(
      (call) => (call[0] as AbortMultipartUploadCommand).input.UploadId,
    );
    expect(uploadIds.sort()).toEqual(["upload-1", "upload-old"]);
    expect(await t.run((ctx) => ctx.db.get(fresh))).toMatchObject({ status: "uploading" });
  });

  it("releases stale rows without a multipart even when storage is unconfigured", async () => {
    const { t } = await uploading({ attachUpload: false });
    vi.stubEnv("R2_ACCOUNT_ID", "");
    ageRows(25);
    const send = fakeS3();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(t.action(internal.storage.abortStaleUploads, {})).resolves.toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps a stale row with a multipart for a later run when storage is unconfigured", async () => {
    const { t, versionId } = await uploading();
    vi.stubEnv("R2_ACCOUNT_ID", "");
    ageRows(25);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(t.action(internal.storage.abortStaleUploads, {})).resolves.toBe(0);
    expect(consoleError).toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(versionId))).toMatchObject({ status: "uploading" });
  });

  it("processes at most 20 rows per run", async () => {
    const { t, a, teamId } = await uploading({ attachUpload: false });
    for (let i = 0; i < 20; i++) {
      await a.mutation(api.versions.begin, {
        mediaId: await a.mutation(api.library.create, { teamId, name: `Extra ${i}` }),
        requestId: `extra-${i}`,
        snapshot: "{}",
        expectedBytes: 10,
        partCount: 1,
      });
    }
    ageRows(25);

    await expect(t.action(internal.storage.abortStaleUploads, {})).resolves.toBe(20);
    await expect(t.action(internal.storage.abortStaleUploads, {})).resolves.toBe(1);
  });
});
