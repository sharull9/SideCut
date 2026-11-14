import { afterEach, describe, expect, it } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as accounts from "./accounts";
import * as billing from "./billing";
import * as library from "./library";
import * as publishJobs from "./publishJobs";
import * as shareAccess from "./shareAccess";
import * as shares from "./shares";
import * as teams from "./teams";
import * as versions from "./versions";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  accounts,
  billing,
  library,
  publishJobs,
  shareAccess,
  shares,
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
const payload = {
  title: "Fixture title",
  description: "User-authored description",
  words: [
    { text: "Hello", start: 0.1, end: 0.4 },
    { text: "world", start: 1, end: 1.4 },
  ],
  chapters: [{ title: "Intro", start: 0 }],
};

// Restore the flag after every test so ordering never leaks billing state.
const originalFlag = process.env.SIDECUT_BILLING_ENABLED;
function setBilling(value: string | undefined) {
  if (value === undefined) delete process.env.SIDECUT_BILLING_ENABLED;
  else process.env.SIDECUT_BILLING_ENABLED = value;
}
afterEach(() => setBilling(originalFlag));

// Fixtures are created with billing off, so a test can enable billing afterwards.
async function setup() {
  setBilling(undefined);
  const t = createTest();
  const a = t.withIdentity(owner);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  const mediaId = await a.mutation(api.library.create, { teamId, name: "Render" });
  const versionId = await a.mutation(api.versions.begin, {
    mediaId,
    requestId: "one",
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
  return { t, a, teamId, mediaId, versionId };
}

async function insertAccount(
  t: Awaited<ReturnType<typeof setup>>["t"],
  teamId: Awaited<ReturnType<typeof setup>>["teamId"],
  expiresAt: number,
) {
  await t.run((ctx) =>
    ctx.db.insert("serviceAccounts", {
      teamId,
      enabled: true,
      limit: 10000,
      used: 0,
      reserved: 0,
      expiresAt,
      sequence: 1,
    }),
  );
}

async function createShare(
  a: Awaited<ReturnType<typeof setup>>["a"],
  versionId: Awaited<ReturnType<typeof setup>>["versionId"],
) {
  return a.action(api.shareAccess.create, {
    versionId,
    private: false,
    comments: true,
    downloads: false,
    expiresAt: Date.now() + 3600000,
  });
}

async function startJob(
  a: Awaited<ReturnType<typeof setup>>["a"],
  versionId: Awaited<ReturnType<typeof setup>>["versionId"],
  requestId = "job",
) {
  return a.mutation(api.publishJobs.start, { versionId, requestId, payload });
}

describe("billing off (self-hosted default)", () => {
  it("keeps upload, share, guest comment and job creation working without an account", async () => {
    const { t, a, teamId, versionId } = await setup();
    expect(process.env.SIDECUT_BILLING_ENABLED).toBeUndefined();

    const upload = await a.mutation(api.versions.begin, {
      mediaId: (await t.run((ctx) => ctx.db.get(versionId)))!.mediaId,
      requestId: "two",
      snapshot: "{}",
      expectedBytes: 5,
      partCount: 1,
    });
    expect(upload).toBeTruthy();
    await expect(a.query(internal.versions.transfer, { versionId })).resolves.toMatchObject({
      version: { _id: versionId },
    });

    const grant = await createShare(a, versionId);
    const session = await t.action(api.shareAccess.open, { token: grant.token, name: "Guest" });
    await expect(
      t.mutation(api.shares.comment, { ...session, requestId: "c1", body: "Hi", at: 0 }),
    ).resolves.toBeTruthy();

    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    await expect(startJob(a, versionId)).resolves.toBeTruthy();
  });
});

describe("billing on without a subscription", () => {
  it("rejects upload start, share creation, guest comment and job creation", async () => {
    const { t, a, teamId, mediaId, versionId } = await setup();
    const grant = await createShare(a, versionId);
    const session = await t.action(api.shareAccess.open, { token: grant.token, name: "Guest" });
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });

    setBilling("true");

    await expect(
      a.mutation(api.versions.begin, {
        mediaId,
        requestId: "two",
        snapshot: "{}",
        expectedBytes: 5,
        partCount: 1,
      }),
    ).rejects.toThrow("Subscription required.");
    await expect(a.query(internal.versions.transfer, { versionId })).rejects.toThrow(
      "Subscription required.",
    );
    await expect(createShare(a, versionId)).rejects.toThrow("Subscription required.");
    await expect(
      t.mutation(api.shares.comment, { ...session, requestId: "c1", body: "Hi", at: 0 }),
    ).rejects.toThrow("Subscription required.");
    await expect(startJob(a, versionId)).rejects.toThrow("Subscription required.");
  });

  it("does not auto-create an enabled account and reports status as disabled", async () => {
    const { t, a, teamId } = await setup();
    setBilling("true");
    await expect(t.run((ctx) => ctx.db.query("serviceAccounts").collect())).resolves.toEqual([]);
    expect(await a.query(api.accounts.status, { teamId })).toMatchObject({
      teamId,
      enabled: false,
    });
    expect(await t.run((ctx) => ctx.db.query("serviceAccounts").collect())).toEqual([]);
  });
});

describe("billing on with an active subscription", () => {
  it("allows upload, share creation, guest comment and job creation", async () => {
    const { t, a, teamId, mediaId, versionId } = await setup();
    await insertAccount(t, teamId, 0);
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    setBilling("true");

    await expect(
      a.mutation(api.versions.begin, {
        mediaId,
        requestId: "two",
        snapshot: "{}",
        expectedBytes: 5,
        partCount: 1,
      }),
    ).resolves.toBeTruthy();
    await expect(a.query(internal.versions.transfer, { versionId })).resolves.toMatchObject({
      version: { _id: versionId },
    });

    const grant = await createShare(a, versionId);
    const session = await t.action(api.shareAccess.open, { token: grant.token, name: "Guest" });
    await expect(
      t.mutation(api.shares.comment, { ...session, requestId: "c1", body: "Hi", at: 0 }),
    ).resolves.toBeTruthy();
    await expect(startJob(a, versionId)).resolves.toBeTruthy();
  });

  it("accepts a future expiry and reports it through subscription", async () => {
    const expiresAt = Date.now() + 86400000;
    const { t, a, teamId } = await setup();
    await insertAccount(t, teamId, expiresAt);
    setBilling("true");
    expect(await a.query(api.billing.subscription, { teamId })).toEqual({
      billingEnabled: true,
      active: true,
      expiresAt,
    });
  });
});

describe("billing on with a lapsed subscription", () => {
  it("rejects new paid operations but keeps reads, listing, export and revoke working", async () => {
    const { t, a, teamId, versionId } = await setup();
    await insertAccount(t, teamId, Date.now() + 3600000);
    const grant = await createShare(a, versionId);
    const session = await t.action(api.shareAccess.open, { token: grant.token, name: "Guest" });
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await startJob(a, versionId);

    // Lapse the subscription after the existing records were created.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("serviceAccounts")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .unique();
      if (!row) throw new Error("Missing account");
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
    });
    setBilling("true");

    await expect(
      t.mutation(api.shares.comment, { ...session, requestId: "c1", body: "Hi", at: 0 }),
    ).rejects.toThrow("Subscription required.");
    await expect(createShare(a, versionId)).rejects.toThrow("Subscription required.");
    await expect(startJob(a, versionId, "job-2")).rejects.toThrow("Subscription required.");

    // Reads, listing, export and revoke remain available.
    await expect(t.query(api.shares.view, session)).resolves.toMatchObject({ version: 1 });
    const [row] = await a.query(api.shares.list, { versionId });
    expect(row).toBeDefined();
    await expect(a.query(api.publishJobs.get, { jobId })).resolves.toMatchObject({ id: jobId });
    await expect(
      a.query(api.accounts.exportData, {
        teamId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toBeDefined();
    await a.mutation(api.shares.revoke, { grantId: row!.id });
    expect(await a.query(api.billing.subscription, { teamId })).toMatchObject({
      billingEnabled: true,
      active: false,
    });
  });
});

describe("public billing queries", () => {
  it("mode reports the flag without requiring sign-in", async () => {
    const t = createTest();
    setBilling(undefined);
    expect(await t.query(api.billing.mode, {})).toEqual({ billingEnabled: false });
    setBilling("1");
    expect(await t.query(api.billing.mode, {})).toEqual({ billingEnabled: true });
    setBilling("TRUE");
    expect(await t.query(api.billing.mode, {})).toEqual({ billingEnabled: false });
  });

  it("subscription reports the off shape and requires membership", async () => {
    const { t, a, teamId } = await setup();
    expect(await a.query(api.billing.subscription, { teamId })).toEqual({
      billingEnabled: false,
      active: true,
      expiresAt: null,
    });
    const b = t.withIdentity(outsider);
    await expect(b.query(api.billing.subscription, { teamId })).rejects.toThrow(
      "Team access denied.",
    );
  });

  it("subscription reports an inactive shape when billing is on and no account exists", async () => {
    const { a, teamId } = await setup();
    setBilling("true");
    expect(await a.query(api.billing.subscription, { teamId })).toEqual({
      billingEnabled: true,
      active: false,
      expiresAt: null,
    });
  });

  it("access is active when billing is off, inactive when signed out or unsubscribed, active with any subscribed workspace", async () => {
    const { t, a, teamId } = await setup();
    expect(await t.query(api.billing.access, {})).toEqual({ billingEnabled: false, active: true });
    setBilling("true");
    expect(await t.query(api.billing.access, {})).toEqual({ billingEnabled: true, active: false });
    expect(await a.query(api.billing.access, {})).toEqual({ billingEnabled: true, active: false });
    await insertAccount(t, teamId, 0);
    expect(await a.query(api.billing.access, {})).toEqual({ billingEnabled: true, active: true });
    const b = t.withIdentity(outsider);
    expect(await b.query(api.billing.access, {})).toEqual({ billingEnabled: true, active: false });
  });
});
