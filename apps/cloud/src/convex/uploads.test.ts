import { afterEach, describe, expect, it } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import type { GenericId } from "convex/values";
import schema from "./schema";
import * as library from "./library";
import * as teams from "./teams";
import * as versions from "./versions";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  library,
  teams,
  versions,
});

const owner = {
  subject: "owner",
  issuer: "https://api.workos.com/",
  email: "owner@example.com",
  emailVerified: true,
};
const outsider = { ...owner, subject: "outsider", email: "outsider@example.com" };

// Restore the flag after every test so ordering never leaks billing state.
const originalFlag = process.env.SIDECUT_BILLING_ENABLED;
function setBilling(value: string | undefined) {
  if (value === undefined) delete process.env.SIDECUT_BILLING_ENABLED;
  else process.env.SIDECUT_BILLING_ENABLED = value;
}
afterEach(() => setBilling(originalFlag));

async function setup() {
  setBilling(undefined);
  const t = createTest();
  const a = t.withIdentity(owner);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  return { t, a, teamId };
}

const base = {
  name: "Render",
  requestId: "req-1",
  fileName: "render.mp4",
  snapshot: "{}",
  expectedBytes: 5,
  partCount: 1,
};

function upload(
  teamId: GenericId<"teams">,
  overrides: Partial<typeof base> & { mediaId?: GenericId<"media"> } = {},
) {
  return { teamId, ...base, ...overrides };
}

async function counts(t: Awaited<ReturnType<typeof setup>>["t"]) {
  return t.run(async (ctx) => ({
    media: (await ctx.db.query("media").collect()).length,
    versions: (await ctx.db.query("mediaVersions").collect()).length,
    parts: (await ctx.db.query("uploadParts").collect()).length,
  }));
}

describe("versions.beginUpload", () => {
  it("creates media and version atomically and is idempotent by requestId", async () => {
    const { t, a, teamId } = await setup();
    const first = await a.mutation(api.versions.beginUpload, upload(teamId));
    const second = await a.mutation(api.versions.beginUpload, upload(teamId));

    expect(second).toEqual(first);
    expect(await counts(t)).toMatchObject({ media: 1, versions: 1 });

    const media = await t.run((ctx) => ctx.db.get(first.mediaId));
    expect(media).toMatchObject({ teamId, name: "Render", createRequestId: "req-1" });
    const version = await t.run((ctx) => ctx.db.get(first.versionId));
    expect(version).toMatchObject({
      mediaId: first.mediaId,
      fileName: "render.mp4",
      status: "uploading",
      number: 1,
    });
  });

  it("rejects a conflicting repeat of the same requestId without writing", async () => {
    const { t, a, teamId } = await setup();
    await a.mutation(api.versions.beginUpload, upload(teamId));

    await expect(
      a.mutation(api.versions.beginUpload, upload(teamId, { snapshot: '{"changed":true}' })),
    ).rejects.toThrow("Request conflicts with existing version.");
    await expect(
      a.mutation(api.versions.beginUpload, upload(teamId, { name: "Other" })),
    ).rejects.toThrow("Request conflicts with existing media.");
    expect(await counts(t)).toMatchObject({ media: 1, versions: 1 });
  });

  it("adds a version to existing media and checks the media belongs to the team", async () => {
    const { t, a, teamId } = await setup();
    const first = await a.mutation(api.versions.beginUpload, upload(teamId));
    const second = await a.mutation(
      api.versions.beginUpload,
      upload(teamId, { mediaId: first.mediaId, requestId: "req-2", fileName: "cut.mov" }),
    );

    expect(second.mediaId).toEqual(first.mediaId);
    expect(second.versionId).not.toEqual(first.versionId);
    const version = await t.run((ctx) => ctx.db.get(second.versionId));
    expect(version).toMatchObject({ number: 2, fileName: "cut.mov" });
    expect(await counts(t)).toMatchObject({ media: 1, versions: 2 });

    const otherTeamId = await a.mutation(api.teams.create, { name: "B" });
    await expect(
      a.mutation(
        api.versions.beginUpload,
        upload(otherTeamId, { mediaId: first.mediaId, requestId: "req-3" }),
      ),
    ).rejects.toThrow("Media unavailable.");
    expect(await counts(t)).toMatchObject({ media: 1, versions: 2 });
  });

  it("rejects invalid file names before creating any media", async () => {
    const { t, a, teamId } = await setup();
    const bad = ["", "a/b.mp4", "a\\b.mp4", "bad\u0001name.mp4", "x".repeat(256)];
    for (const fileName of bad) {
      await expect(
        a.mutation(api.versions.beginUpload, upload(teamId, { fileName })),
      ).rejects.toThrow("Invalid file name.");
    }
    expect(await counts(t)).toMatchObject({ media: 0, versions: 0 });
  });

  it("requires a subscription when billing is on and creates nothing", async () => {
    const { t, a, teamId } = await setup();
    setBilling("true");

    await expect(a.mutation(api.versions.beginUpload, upload(teamId))).rejects.toThrow(
      "Subscription required.",
    );
    expect(await counts(t)).toMatchObject({ media: 0, versions: 0 });
  });
});

describe("versions.cancelUpload", () => {
  it("deletes orphan media with its cancelled version and parts", async () => {
    const { t, a, teamId } = await setup();
    const { mediaId, versionId } = await a.mutation(api.versions.beginUpload, upload(teamId));
    await t.mutation(internal.versions.recordPart, { versionId, part: 1, etag: "p", bytes: 5 });

    const result = await t.mutation(internal.versions.cancelUpload, {
      versionId,
      reason: "cancelled",
    });
    expect(result).toMatchObject({ cancelled: true, uploadId: null });
    expect(result.objectKey).toBe(`${teamId}/${mediaId}/1/source`);
    expect(await counts(t)).toEqual({ media: 0, versions: 0, parts: 0 });
  });

  it("keeps media that still has another live version and is idempotent", async () => {
    const { t, a, teamId } = await setup();
    const first = await a.mutation(api.versions.beginUpload, upload(teamId));
    const second = await a.mutation(
      api.versions.beginUpload,
      upload(teamId, { mediaId: first.mediaId, requestId: "req-2" }),
    );

    const once = await t.mutation(internal.versions.cancelUpload, {
      versionId: first.versionId,
      reason: "cancelled",
    });
    expect(once.cancelled).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(first.mediaId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(first.versionId))).toMatchObject({
      status: "cancelled",
    });
    expect(await t.run((ctx) => ctx.db.get(second.versionId))).toMatchObject({
      status: "uploading",
    });

    const again = await t.mutation(internal.versions.cancelUpload, {
      versionId: first.versionId,
      reason: "stale",
    });
    expect(again).toMatchObject({ cancelled: false, objectKey: once.objectKey, uploadId: null });
    expect(await counts(t)).toMatchObject({ media: 1, versions: 2 });
  });

  it("reports unavailable for a version whose orphan media was already deleted", async () => {
    const { t, a, teamId } = await setup();
    const { versionId } = await a.mutation(api.versions.beginUpload, upload(teamId));
    await t.mutation(internal.versions.cancelUpload, { versionId, reason: "cancelled" });

    await expect(
      t.mutation(internal.versions.cancelUpload, { versionId, reason: "cancelled" }),
    ).rejects.toThrow("Upload unavailable.");
  });
});

describe("versions.authorizeCancel", () => {
  it("returns version info for editors and rejects outsiders", async () => {
    const { t, a, teamId } = await setup();
    const { versionId } = await a.mutation(api.versions.beginUpload, upload(teamId));

    await expect(a.query(internal.versions.authorizeCancel, { versionId })).resolves.toMatchObject({
      versionId,
      status: "uploading",
    });
    const b = t.withIdentity(outsider);
    await expect(b.query(internal.versions.authorizeCancel, { versionId })).rejects.toThrow(
      "Team access denied.",
    );
  });
});

describe("versions.staleUploads", () => {
  it("selects only uploading versions older than the cutoff, capped by limit", async () => {
    const { t, a, teamId } = await setup();
    const one = await a.mutation(api.versions.beginUpload, upload(teamId, { requestId: "r1" }));
    await a.mutation(api.versions.beginUpload, upload(teamId, { requestId: "r2" }));
    await a.mutation(api.versions.beginUpload, upload(teamId, { requestId: "r3" }));
    await t.mutation(internal.versions.cancelUpload, {
      versionId: one.versionId,
      reason: "cancelled",
    });

    const future = Date.now() + 60000;
    const all = await t.query(internal.versions.staleUploads, { olderThan: future, limit: 10 });
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ objectKey: expect.any(String), uploadId: null });
    expect(all.map((row) => row._id)).not.toContain(one.versionId);

    expect(await t.query(internal.versions.staleUploads, { olderThan: 0, limit: 10 })).toEqual([]);
    expect(await t.query(internal.versions.staleUploads, { olderThan: future, limit: 0 })).toEqual(
      [],
    );
    expect(
      await t.query(internal.versions.staleUploads, { olderThan: future, limit: 1 }),
    ).toHaveLength(1);
  });
});
