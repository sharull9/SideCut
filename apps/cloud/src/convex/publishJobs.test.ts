import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as accounts from "./accounts";
import * as teams from "./teams";
import * as library from "./library";
import * as publishJobs from "./publishJobs";
import { publishPackStep, validatePublishPayload } from "./publishPack";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  accounts,
  teams,
  library,
  publishJobs,
});
const alice = {
  subject: "alice",
  issuer: "https://api.workos.com/",
  email: "alice@example.com",
  emailVerified: true,
};
const bob = { ...alice, subject: "bob", email: "bob@example.com" };
const payload = {
  title: "Fixture title",
  description: "User-authored description",
  words: [
    { text: "Hello", start: 0.1, end: 0.4 },
    { text: "world", start: 1, end: 1.4 },
  ],
  chapters: [{ title: "Intro", start: 0 }],
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = createTest();
  const a = t.withIdentity(alice);
  const b = t.withIdentity(bob);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  const mediaId = await a.mutation(api.library.create, { teamId, name: "Source" });
  const versionId = await t.run((ctx) =>
    ctx.db.insert("mediaVersions", {
      mediaId,
      number: 1,
      requestId: "source",
      snapshot: "{}",
      expectedBytes: 1,
      partCount: 1,
      status: "ready",
      attempt: 1,
      objectKey: `${teamId}/${mediaId}/1/source`,
    }),
  );
  const start = (requestId = "job") =>
    a.mutation(api.publishJobs.start, { versionId, requestId, payload });
  return { t, a, b, teamId, mediaId, versionId, start };
}

describe("consent-gated publish gateway and durable workers", () => {
  it("reports actual outputs, refuses consent-off work, deduplicates requests and executes the scheduled server worker", async () => {
    const { t, a, teamId, versionId, start } = await setup();
    expect(await a.query(api.publishJobs.capabilities, {})).toMatchObject({
      aiEnabled: false,
      publishesExternally: false,
      outputs: ["transcript.txt", "captions.srt", "metadata.json", "chapters.txt"],
    });
    await expect(start()).rejects.toThrow(/consent/);
    const generation = await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    expect(await a.mutation(api.publishJobs.consent, { teamId, enabled: true })).toBe(generation);
    const jobId = await start();
    expect(await start()).toBe(jobId);
    expect(
      await a.mutation(api.publishJobs.start, {
        versionId,
        requestId: "job",
        payload: {
          chapters: payload.chapters,
          words: payload.words,
          description: payload.description,
          title: payload.title,
        },
      }),
    ).toBe(jobId);
    await expect(
      a.mutation(api.publishJobs.start, {
        versionId,
        requestId: "job",
        payload: { ...payload, title: "Different" },
      }),
    ).rejects.toThrow(/conflicts/);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const result = await a.query(api.publishJobs.get, { jobId });
    expect(result).toMatchObject({ status: "ready", checkpoint: 2, attempt: 1 });
    expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
      "transcript.txt",
      "captions.srt",
      "metadata.json",
      "chapters.txt",
    ]);
    expect(result.artifacts[1]?.text).toContain("00:00:00,100 --> 00:00:00,400");
    expect(JSON.parse(result.artifacts[2]!.text).generatedByAI).toBe(false);
    await a.mutation(api.publishJobs.resume, { jobId });
    expect((await a.query(api.publishJobs.get, { jobId })).attempt).toBe(1);
  });
  it("reclaims expired leases, resumes committed steps and rejects stale or out-of-order callbacks", async () => {
    const { t, a, teamId, start } = await setup();
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    const first = await t.mutation(internal.publishJobs.claim, { jobId });
    expect(first?.attempt).toBe(1);
    expect(await t.mutation(internal.publishJobs.claim, { jobId })).toBeNull();
    await expect(
      t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 1 }),
    ).rejects.toThrow(/Out-of-order/);
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 })).toBe(
      true,
    );
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 })).toBe(
      true,
    );
    await t.run((ctx) => ctx.db.patch(jobId, { leaseUntil: Date.now() - 1 }));
    await a.mutation(api.publishJobs.resume, { jobId });
    const second = await t.mutation(internal.publishJobs.claim, { jobId });
    expect(second?.checkpoint).toBe(1);
    expect(second?.attempt).toBe(2);
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 1 })).toBe(
      false,
    );
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 2, step: 1 })).toBe(
      true,
    );
    expect((await a.query(api.publishJobs.get, { jobId })).artifacts).toHaveLength(4);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  it("revokes in-flight processing and output access without resurrecting old consent generations", async () => {
    const { t, a, teamId, start } = await setup();
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    await t.mutation(internal.publishJobs.claim, { jobId });
    await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 });
    await a.mutation(api.publishJobs.consent, { teamId, enabled: false });
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 1 })).toBe(
      false,
    );
    expect(await a.query(api.publishJobs.get, { jobId })).toMatchObject({
      status: "cancelled",
      artifacts: [],
    });
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    await expect(a.mutation(api.publishJobs.resume, { jobId })).rejects.toThrow(/revoked/);
    await expect(start()).rejects.toThrow(/conflicts/);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  it("isolates creators/tenants, denies viewers and refuses acknowledgements after membership removal", async () => {
    const { t, a, b, teamId, versionId, start } = await setup();
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    await expect(b.query(api.publishJobs.get, { jobId })).rejects.toThrow(/unavailable/);
    await expect(
      b.mutation(api.publishJobs.start, { versionId, requestId: "bob", payload }),
    ).rejects.toThrow(/access denied/);
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "viewer",
    });
    await b.mutation(api.teams.accept, { invitationId });
    await expect(b.mutation(api.publishJobs.consent, { teamId, enabled: true })).rejects.toThrow(
      /Editing/,
    );
    await expect(
      b.mutation(api.publishJobs.start, { versionId, requestId: "bob", payload }),
    ).rejects.toThrow(/Editing/);
    await t.mutation(internal.publishJobs.claim, { jobId });
    await t.run(async (ctx) => {
      const members = await ctx.db.query("memberships").collect();
      const owner = members.find((m) => m.role === "owner")!;
      await ctx.db.delete(owner._id);
    });
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 })).toBe(
      false,
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  it("cancels jobs permanently and bounds worker retries", async () => {
    const { t, a, teamId, start } = await setup();
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const cancelled = await start("cancel");
    await a.mutation(api.publishJobs.cancel, { jobId: cancelled });
    expect(await t.mutation(internal.publishJobs.claim, { jobId: cancelled })).toBeNull();
    await expect(a.mutation(api.publishJobs.resume, { jobId: cancelled })).rejects.toThrow(
      /cannot be resumed/,
    );
    const jobId = await start("retry");
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await t.mutation(internal.publishJobs.claim, { jobId }))?.attempt).toBe(attempt);
      await t.run((ctx) => ctx.db.patch(jobId, { leaseUntil: Date.now() - 1 }));
    }
    expect(await t.mutation(internal.publishJobs.claim, { jobId })).toBeNull();
    await expect(a.mutation(api.publishJobs.resume, { jobId })).rejects.toThrow(
      /cannot be resumed/,
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  it("validates word clocks and payload limits and produces deterministic metadata", () => {
    expect(() =>
      validatePublishPayload({ ...payload, words: [{ text: "too short", start: 0, end: 0.0001 }] }),
    ).toThrow(/transcript/);
    expect(publishPackStep(payload, 0)).toEqual(publishPackStep(payload, 0));
    expect(() =>
      validatePublishPayload({ ...payload, words: [{ text: "bad", start: 2, end: 1 }] }),
    ).toThrow(/transcript/);
    expect(() =>
      validatePublishPayload({ ...payload, words: [{ text: "injection\n\n2", start: 0, end: 1 }] }),
    ).toThrow(/transcript/);
    expect(() =>
      validatePublishPayload({ ...payload, chapters: [{ title: "bad", start: 99 }] }),
    ).toThrow(/chapters/);
    expect(() =>
      validatePublishPayload({ ...payload, words: Array(1001).fill(payload.words[0]) }),
    ).toThrow(/limits/);
  });
});

describe("service accounts and checkpoint usage", () => {
  it("reserves atomically, charges committed work once and releases only unfinished work", async () => {
    const { t, a, teamId, start } = await setup();
    await t.mutation(internal.accounts.billingEvent, {
      eventId: "limit",
      teamId,
      sequence: 1,
      enabled: true,
      limit: 3,
      expiresAt: 0,
    });
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    await start();
    expect(await a.query(api.accounts.status, { teamId })).toMatchObject({ used: 0, reserved: 2 });
    await expect(start("over-quota")).rejects.toThrow(/quota/);
    const exported = await a.query(api.accounts.exportData, {
      teamId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(exported.page).toHaveLength(1);
    await t.mutation(internal.publishJobs.claim, { jobId });
    await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 });
    await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 });
    expect(await a.query(api.accounts.status, { teamId })).toMatchObject({ used: 1, reserved: 1 });
    await a.mutation(api.publishJobs.cancel, { jobId });
    await a.mutation(api.publishJobs.cancel, { jobId });
    expect(await a.query(api.accounts.status, { teamId })).toMatchObject({ used: 1, reserved: 0 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  it("deduplicates billing events, ignores older events and enforces expiry without undoing usage", async () => {
    const { t, a, teamId, start } = await setup();
    const event = { eventId: "new", teamId, sequence: 2, enabled: true, limit: 10, expiresAt: 0 };
    expect(await t.mutation(internal.accounts.billingEvent, event)).toBe(true);
    expect(await t.mutation(internal.accounts.billingEvent, event)).toBe(false);
    await expect(
      t.mutation(internal.accounts.billingEvent, { ...event, limit: 20 }),
    ).rejects.toThrow(/conflicts/);
    expect(
      await t.mutation(internal.accounts.billingEvent, {
        ...event,
        eventId: "old",
        sequence: 1,
        limit: 500,
      }),
    ).toBe(false);
    expect(await a.query(api.accounts.status, { teamId })).toMatchObject({
      limit: 10,
      sequence: 2,
    });
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    await t.mutation(internal.publishJobs.claim, { jobId });
    await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 0 });
    await t.mutation(internal.accounts.billingEvent, {
      ...event,
      eventId: "expired",
      sequence: 3,
      expiresAt: Date.now() - 1,
    });
    expect(await t.mutation(internal.publishJobs.checkpoint, { jobId, attempt: 1, step: 1 })).toBe(
      false,
    );
    expect(await a.query(api.accounts.status, { teamId })).toMatchObject({ used: 1, reserved: 0 });
    await expect(start("expired-job")).rejects.toThrow(/entitlement/);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  it("exports only creator data and deletes text while retaining a request tombstone and usage ledger", async () => {
    const { t, a, b, teamId, start } = await setup();
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    await expect(a.mutation(api.accounts.deleteJob, { jobId })).rejects.toThrow(/Cancel/);
    await expect(
      b.query(api.accounts.exportData, { teamId, paginationOpts: { numItems: 20, cursor: null } }),
    ).rejects.toThrow(/access denied/);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(b.mutation(api.accounts.deleteJob, { jobId })).rejects.toThrow(/unavailable/);
    await a.mutation(api.accounts.deleteJob, { jobId });
    const exported = await a.query(api.accounts.exportData, {
      teamId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(exported.page[0]).toMatchObject({
      payload: { words: [], description: "" },
      artifacts: [],
      status: "cancelled",
    });
    expect(JSON.stringify(exported)).not.toContain("Fixture title");
    expect(exported.usage).toMatchObject({ used: 2, reserved: 0 });
    await expect(start()).rejects.toThrow(/retired/);
  });
  it("purges old terminal content in bounded batches without deleting pending jobs", async () => {
    const { t, a, teamId, start } = await setup();
    await a.mutation(api.publishJobs.consent, { teamId, enabled: true });
    const jobId = await start();
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    vi.setSystemTime(Date.now() + 31 * 86400000);
    expect(await t.mutation(internal.accounts.purge, {})).toBe(1);
    expect(await t.mutation(internal.accounts.purge, {})).toBe(0);
    expect((await a.query(api.publishJobs.get, { jobId })).artifacts).toEqual([]);
  });
});
