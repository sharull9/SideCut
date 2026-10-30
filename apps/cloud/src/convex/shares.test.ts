import { describe, expect, it } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as teams from "./teams";
import * as library from "./library";
import * as versions from "./versions";
import * as shares from "./shares";
import * as shareAccess from "./shareAccess";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  teams,
  library,
  versions,
  shares,
  shareAccess,
});
const owner = {
  subject: "owner",
  issuer: "https://api.workos.com/",
  email: "owner@example.com",
  emailVerified: true,
};
const viewer = { ...owner, subject: "viewer", email: "viewer@example.com" };
async function setup() {
  const t = createTest();
  const a = t.withIdentity(owner);
  const b = t.withIdentity(viewer);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  const mediaId = await a.mutation(api.library.create, { teamId, name: "Render" });
  const ready = async (requestId: string) => {
    const versionId = await a.mutation(api.versions.begin, {
      mediaId,
      requestId,
      snapshot: "{}",
      expectedBytes: 5,
      partCount: 1,
    });
    await t.mutation(internal.versions.recordPart, { versionId, part: 1, etag: "part", bytes: 5 });
    await t.mutation(internal.versions.uploaded, { versionId });
    const version = await t.run((ctx) => ctx.db.get(versionId));
    if (!version) throw new Error("Missing version");
    await t.mutation(internal.versions.processed, {
      versionId,
      attempt: 1,
      result: {
        status: "ready",
        playbackKey: `${teamId}/${mediaId}/${version.number}/attempt-1/playback.mp4`,
      },
    });
    return versionId;
  };
  const versionId = await ready("one");
  const create = (
    options: { private?: boolean; comments?: boolean; downloads?: boolean; password?: string } = {},
  ) =>
    a.action(api.shareAccess.create, {
      versionId,
      private: false,
      comments: true,
      downloads: false,
      expiresAt: Date.now() + 3600000,
      ...options,
    });
  return { t, a, b, teamId, mediaId, versionId, ready, create };
}

describe("version-bound guest review", () => {
  it("hashes tokens, checks passwords, hides secret metadata and denies original downloads", async () => {
    const { t, a, versionId, create } = await setup();
    const grant = await create({ password: "long enough password" });
    await expect(
      t.action(api.shareAccess.open, { token: grant.token, name: "Guest", password: "wrong" }),
    ).rejects.toThrow("unavailable");
    const session = await t.action(api.shareAccess.open, {
      token: grant.token,
      name: "Guest",
      password: "long enough password",
    });
    const view = await t.query(api.shares.view, session);
    expect(view).toMatchObject({ version: 1, downloads: false, workflow: "review" });
    expect(JSON.stringify(view)).not.toContain("playback.mp4");
    expect(JSON.stringify(view)).not.toContain("tokenHash");
    expect(JSON.stringify(await a.query(api.shares.list, { versionId }))).not.toContain(
      grant.token,
    );
    await expect(t.query(internal.shares.delivery, { ...session, download: true })).rejects.toThrow(
      "Downloads disabled",
    );
    expect(
      (await t.query(internal.shares.delivery, { ...session, download: false })).key,
    ).toContain("/1/attempt-1/");
    const records = await t.run((ctx) => ctx.db.query("guestSessions").collect());
    expect(records[0]?.tokenHash).not.toBe(session.sessionToken);
  });

  it("revokes sessions, feedback and new media grants immediately", async () => {
    const { t, a, versionId, create } = await setup();
    const grant = await create();
    const session = await t.action(api.shareAccess.open, { token: grant.token, name: "Guest" });
    const row = (await a.query(api.shares.list, { versionId }))[0];
    if (!row) throw new Error("Missing grant");
    await a.mutation(api.shares.revoke, { grantId: row.id });
    await expect(t.query(api.shares.view, session)).rejects.toThrow("unavailable");
    await expect(
      t.mutation(api.shares.comment, { ...session, requestId: "one", body: "Hi", at: 0 }),
    ).rejects.toThrow("unavailable");
    await expect(
      t.query(internal.shares.delivery, { ...session, download: false }),
    ).rejects.toThrow("unavailable");
    await expect(
      t.action(api.shareAccess.open, { token: grant.token, name: "Again" }),
    ).rejects.toThrow("unavailable");
  });

  it("checks current private membership and binds sessions to the authenticated recipient", async () => {
    const { t, a, b, teamId, create } = await setup();
    const grant = await create({ private: true });
    await expect(
      t.action(api.shareAccess.open, { token: grant.token, name: "Guest" }),
    ).rejects.toThrow("Sign in");
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: viewer.email,
      role: "viewer",
    });
    await b.mutation(api.teams.accept, { invitationId });
    const session = await b.action(api.shareAccess.open, { token: grant.token, name: "Viewer" });
    await expect(a.query(api.shares.view, session)).rejects.toThrow("unavailable");
    const member = (await a.query(api.teams.members, { teamId })).find((m) => m.role === "viewer");
    if (!member) throw new Error("Missing viewer");
    await a.mutation(api.teams.removeMember, { membershipId: member._id });
    await expect(b.query(api.shares.view, session)).rejects.toThrow("access denied");
  });

  it("isolates revisions and grants, deduplicates retries and preserves concurrent replies", async () => {
    const { t, ready, create } = await setup();
    const grant = await create();
    const first = await t.action(api.shareAccess.open, { token: grant.token, name: "First" });
    const second = await t.action(api.shareAccess.open, { token: grant.token, name: "Second" });
    const args = { ...first, requestId: "root", body: "Change this", at: 1, end: 2 };
    const root = await t.mutation(api.shares.comment, args);
    expect(await t.mutation(api.shares.comment, args)).toBe(root);
    await expect(t.mutation(api.shares.comment, { ...args, body: "conflict" })).rejects.toThrow(
      "conflicts",
    );
    await Promise.all(
      [first, second].map((session, i) =>
        t.mutation(api.shares.comment, {
          ...session,
          requestId: "reply",
          body: `Reply ${i}`,
          at: 1,
          parentId: root,
        }),
      ),
    );
    expect((await t.query(api.shares.view, first)).feedback).toHaveLength(3);
    await ready("two");
    expect((await t.query(api.shares.view, first)).version).toBe(1);
    const separate = await create();
    const isolated = await t.action(api.shareAccess.open, { token: separate.token, name: "Third" });
    expect((await t.query(api.shares.view, isolated)).feedback).toHaveLength(0);
    await expect(
      t.mutation(api.shares.comment, {
        ...isolated,
        requestId: "bad",
        body: "Cross grant",
        at: 1,
        parentId: root,
      }),
    ).rejects.toThrow("Thread unavailable");
    await expect(
      t.mutation(api.shares.resolve, { ...second, commentId: root, resolved: true }),
    ).rejects.toThrow("Thread unavailable");
    await t.mutation(api.shares.resolve, { ...first, commentId: root, resolved: true });
  });

  it("enforces comments policy, presence expiry, workflow revisions and share expiry", async () => {
    const { t, a, b, versionId, create } = await setup();
    const grant = await create({ comments: false, downloads: true });
    const session = await t.action(api.shareAccess.open, { token: grant.token, name: "Guest" });
    await expect(
      t.mutation(api.shares.comment, { ...session, requestId: "bad", body: "No", at: 0 }),
    ).rejects.toThrow("disabled");
    expect((await t.query(internal.shares.delivery, { ...session, download: true })).key).toContain(
      "/source",
    );
    await t.run(async (ctx) => {
      for (const s of await ctx.db.query("guestSessions").collect())
        await ctx.db.patch(s._id, { lastSeen: 0 });
    });
    expect((await t.query(api.shares.view, session)).presence).toHaveLength(0);
    await t.mutation(api.shares.heartbeat, session);
    expect((await t.query(api.shares.view, session)).presence).toHaveLength(1);
    await expect(
      b.mutation(api.shares.workflow, { versionId, expectedRevision: 0, state: "done" }),
    ).rejects.toThrow("access denied");
    await a.mutation(api.shares.workflow, { versionId, expectedRevision: 0, state: "rework" });
    await expect(
      a.mutation(api.shares.workflow, { versionId, expectedRevision: 0, state: "done" }),
    ).rejects.toThrow("changed");
    expect((await t.query(api.shares.view, session)).workflow).toBe("rework");
    await t.run(async (ctx) => {
      for (const g of await ctx.db.query("shareGrants").collect())
        await ctx.db.patch(g._id, { expiresAt: 0 });
    });
    await expect(t.query(api.shares.view, session)).rejects.toThrow("unavailable");
  });
});
