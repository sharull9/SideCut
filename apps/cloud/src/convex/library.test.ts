import { describe, expect, it } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import schema from "./schema";
import * as teams from "./teams";
import * as library from "./library";
import * as versions from "./versions";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  teams,
  library,
  versions,
});
const alice = {
  subject: "alice",
  issuer: "https://api.workos.com/",
  email: "alice@example.com",
  emailVerified: true,
};
const bob = { ...alice, subject: "bob", email: "bob@example.com" };
async function setup() {
  const t = createTest();
  const a = t.withIdentity(alice);
  const b = t.withIdentity(bob);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  const mediaId = await a.mutation(api.library.create, { teamId, name: "Render" });
  const begin = (requestId: string) =>
    a.mutation(api.versions.begin, {
      mediaId,
      requestId,
      snapshot: '{"revision":1}',
      expectedBytes: 10,
      partCount: 2,
    });
  const upload = async (versionId: Awaited<ReturnType<typeof begin>>) => {
    for (const part of [2, 1])
      await t.mutation(internal.versions.recordPart, {
        versionId,
        part,
        etag: `part-${part}`,
        bytes: 5,
      });
    await t.mutation(internal.versions.uploaded, { versionId });
  };
  return { t, a, b, teamId, mediaId, begin, upload };
}

describe("cloud library and immutable versions", () => {
  it("pages beyond 1,000 records without losing matches or tenant/archive/folder scope", async () => {
    const { t, a, b, teamId } = await setup();
    const folderId = await a.mutation(api.library.createFolder, { teamId, name: "Page fixture" });
    await t.run(async (ctx) => {
      for (let index = 0; index < 1005; index++)
        await ctx.db.insert("media", {
          teamId,
          folderId,
          name: `Recording ${String(index).padStart(4, "0")}`,
          archived: false,
          nextVersion: 1,
        });
    });
    const args = { teamId, folderId, sort: "name" } satisfies Pick<
      FunctionArgs<typeof api.library.page>,
      "teamId" | "folderId" | "sort"
    >;
    let cursor: string | null = null;
    const names: string[] = [];
    for (;;) {
      const page: FunctionReturnType<typeof api.library.page> = await a.query(api.library.page, {
        ...args,
        paginationOpts: { numItems: 100, cursor },
      });
      names.push(...page.page.map((item) => item.name));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(names).toHaveLength(1005);
    expect(new Set(names).size).toBe(1005);
    expect(names.at(-1)).toBe("Recording 1004");
    expect(
      (
        await a.query(api.library.page, {
          ...args,
          sort: "newest",
          paginationOpts: { numItems: 2, cursor: null },
        })
      ).page.map((item) => item.name),
    ).toEqual(["Recording 1004", "Recording 1003"]);
    const search = { ...args, search: "1004", paginationOpts: { numItems: 2, cursor: null } };
    const match = await a.query(api.library.page, search);
    expect(match.page.map((item) => item.name)).toEqual(["Recording 1004"]);
    const matchId = match.page[0]?._id;
    if (!matchId) throw new Error("Missing indexed search match");
    await a.mutation(api.library.bulk, { teamId, mediaIds: [matchId], operation: "archive" });
    expect((await a.query(api.library.page, search)).page).toHaveLength(0);
    expect((await a.query(api.library.page, { ...search, archived: true })).page).toHaveLength(1);
    const otherTeam = await b.mutation(api.teams.create, { name: "B" });
    await b.mutation(api.library.create, { teamId: otherTeam, name: "Recording 1004" });
    expect((await a.query(api.library.page, search)).page).toHaveLength(0);
    await expect(b.query(api.library.page, search)).rejects.toThrow("access denied");
    await expect(
      a.query(api.library.page, { ...search, paginationOpts: { numItems: 101, cursor: null } }),
    ).rejects.toThrow("Page size");
  });

  it("isolates folders, bulk actions, versions and playback across tenants", async () => {
    const { t, a, b, teamId, mediaId, begin } = await setup();
    await expect(b.query(api.library.list, { teamId, sort: "name" })).rejects.toThrow(
      "access denied",
    );
    await expect(b.query(api.versions.list, { mediaId })).rejects.toThrow("access denied");
    await expect(b.query(internal.versions.playback, { mediaId })).rejects.toThrow("access denied");
    const other = await b.mutation(api.teams.create, { name: "B" });
    const folderId = await b.mutation(api.library.createFolder, { teamId: other, name: "Private" });
    await expect(
      a.mutation(api.library.bulk, { teamId, mediaIds: [mediaId], operation: "move", folderId }),
    ).rejects.toThrow("Folder unavailable");
    await expect(t.query(api.library.folders, { teamId })).rejects.toThrow("Sign in");
    await begin("one");
  });

  it("enforces viewer permissions, filtering and atomic bulk changes", async () => {
    const { a, b, teamId, mediaId } = await setup();
    const folderId = await a.mutation(api.library.createFolder, { teamId, name: "Exports" });
    await a.mutation(api.library.bulk, {
      teamId,
      mediaIds: [mediaId, mediaId],
      operation: "move",
      folderId,
    });
    expect(
      await a.query(api.library.list, { teamId, folderId, search: "REND", sort: "name" }),
    ).toHaveLength(1);
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "viewer",
    });
    await b.mutation(api.teams.accept, { invitationId });
    expect(
      (
        await b.query(api.library.page, {
          teamId,
          sort: "name",
          paginationOpts: { numItems: 25, cursor: null },
        })
      ).page,
    ).toHaveLength(1);
    await expect(b.mutation(api.library.create, { teamId, name: "Bad" })).rejects.toThrow(
      "Editing access",
    );
    await expect(
      b.mutation(api.library.bulk, { teamId, mediaIds: [mediaId], operation: "archive" }),
    ).rejects.toThrow("Editing access");
    await a.mutation(api.library.bulk, { teamId, mediaIds: [mediaId], operation: "archive" });
    expect(await a.query(api.library.list, { teamId, sort: "newest" })).toHaveLength(0);
    expect(
      await a.query(api.library.list, { teamId, sort: "newest", archived: true }),
    ).toMatchObject([{ _id: mediaId, archived: true }]);
    expect(
      await b.query(api.library.list, { teamId, sort: "newest", archived: true }),
    ).toHaveLength(1);
    await expect(
      b.mutation(api.library.bulk, { teamId, mediaIds: [mediaId], operation: "restore" }),
    ).rejects.toThrow("Editing access");
    await a.mutation(api.library.bulk, { teamId, mediaIds: [mediaId], operation: "restore" });
    expect(await a.query(api.library.list, { teamId, sort: "newest" })).toHaveLength(1);
  });

  it("deduplicates begins and out-of-order parts and rejects incomplete or conflicting uploads", async () => {
    const { t, a, mediaId, begin, upload } = await setup();
    const versionId = await begin("same");
    expect(await begin("same")).toBe(versionId);
    await expect(
      a.mutation(api.versions.begin, {
        mediaId,
        requestId: "same",
        snapshot: "different",
        expectedBytes: 10,
        partCount: 2,
      }),
    ).rejects.toThrow("conflicts");
    await expect(t.mutation(internal.versions.uploaded, { versionId })).rejects.toThrow(
      "incomplete",
    );
    const part = { versionId, part: 2, etag: "part-2", bytes: 5 };
    await t.mutation(internal.versions.recordPart, part);
    await t.mutation(internal.versions.recordPart, part);
    await expect(
      t.mutation(internal.versions.recordPart, { ...part, etag: "changed" }),
    ).rejects.toThrow("conflicts");
    await upload(versionId);
    await t.mutation(internal.versions.uploaded, { versionId });
    expect((await a.query(api.versions.list, { mediaId }))[0]?.status).toBe("processing");
  });

  it("retains ready output on failure, ignores stale jobs and never rolls back to older results", async () => {
    const { t, a, teamId, mediaId, begin, upload } = await setup();
    const first = await begin("one");
    await upload(first);
    const firstKey = `${teamId}/${mediaId}/1/attempt-1/playback.mp4`;
    await t.mutation(internal.versions.processed, {
      versionId: first,
      attempt: 1,
      result: { status: "ready", playbackKey: firstKey },
    });
    const second = await begin("two");
    await upload(second);
    await t.mutation(internal.versions.processed, {
      versionId: second,
      attempt: 1,
      result: { status: "failed", error: "encoder stopped" },
    });
    expect((await a.query(internal.versions.playback, { mediaId })).key).toBe(firstKey);
    await a.mutation(api.versions.retryProcessing, { versionId: second });
    await t.mutation(internal.versions.processed, {
      versionId: second,
      attempt: 1,
      result: { status: "failed", error: "late" },
    });
    const secondKey = `${teamId}/${mediaId}/2/attempt-2/playback.mp4`;
    await expect(
      t.mutation(internal.versions.processed, {
        versionId: second,
        attempt: 2,
        result: { status: "ready", playbackKey: firstKey },
      }),
    ).rejects.toThrow("namespace");
    await t.mutation(internal.versions.processed, {
      versionId: second,
      attempt: 2,
      result: { status: "ready", playbackKey: secondKey },
    });
    await t.mutation(internal.versions.processed, {
      versionId: first,
      attempt: 1,
      result: { status: "failed", error: "duplicate stale failure" },
    });
    expect((await a.query(internal.versions.playback, { mediaId })).key).toBe(secondKey);
    expect((await a.query(internal.versions.playback, { mediaId, versionId: first })).key).toBe(
      firstKey,
    );
    expect(
      (await a.query(api.versions.list, { mediaId })).find((v) => v._id === first)?.snapshot,
    ).toBe('{"revision":1}');
  });

  it("rechecks membership and archival at playback authorization time", async () => {
    const { t, a, b, teamId, mediaId, begin, upload } = await setup();
    const versionId = await begin("one");
    await upload(versionId);
    await t.mutation(internal.versions.processed, {
      versionId,
      attempt: 1,
      result: { status: "ready", playbackKey: `${teamId}/${mediaId}/1/attempt-1/playback.mp4` },
    });
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "viewer",
    });
    await b.mutation(api.teams.accept, { invitationId });
    expect((await b.query(internal.versions.playback, { mediaId })).versionId).toBe(versionId);
    const member = (await a.query(api.teams.members, { teamId })).find((m) => m.role === "viewer");
    if (!member) throw new Error("Missing viewer");
    await a.mutation(api.teams.removeMember, { membershipId: member._id });
    await expect(b.query(internal.versions.playback, { mediaId })).rejects.toThrow("access denied");
    await a.mutation(api.library.bulk, { teamId, mediaIds: [mediaId], operation: "archive" });
    await expect(a.query(internal.versions.playback, { mediaId })).rejects.toThrow("archived");
  });
});
