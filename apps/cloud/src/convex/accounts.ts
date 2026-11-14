import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { GenericId } from "convex/values";
import { query, mutation, type MutationCtx } from "./model";
import { internalMutation } from "./_generated/server";
import { membership, identity } from "./access";
import { billingEnabled, serviceAccount as account } from "./billing";

export async function reserve(
  ctx: MutationCtx,
  teamId: GenericId<"teams">,
  jobId: GenericId<"publishJobs">,
  units: number,
) {
  if (!Number.isSafeInteger(units) || units < 1 || units > 1000)
    throw new ConvexError("Invalid usage reservation.");
  let row = await account(ctx, teamId);
  if (!row) {
    // Billing on: an account row must come from a verified billing event, never a fixture.
    if (billingEnabled()) throw new ConvexError("Subscription required.");
    const id = await ctx.db.insert("serviceAccounts", {
      teamId,
      enabled: true,
      limit: 10000,
      used: 0,
      reserved: 0,
      expiresAt: 0,
      sequence: 0,
    });
    row = await ctx.db.get(id);
  }
  if (!row || !row.enabled || (row.expiresAt !== 0 && row.expiresAt <= Date.now()))
    throw new ConvexError("Service entitlement unavailable.");
  if (row.used + row.reserved + units > row.limit) throw new ConvexError("Service quota exceeded.");
  const prior = await ctx.db
    .query("usageReservations")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .unique();
  if (prior) throw new ConvexError("Job already has a reservation.");
  await ctx.db.insert("usageReservations", {
    teamId,
    jobId,
    total: units,
    consumed: 0,
    remaining: units,
  });
  await ctx.db.patch(row._id, { reserved: row.reserved + units });
}

/** Charge committed work, then release unfinished units on cancellation/failure. */
export async function settle(
  ctx: MutationCtx,
  jobId: GenericId<"publishJobs">,
  step: 0 | 1 | "release",
) {
  const reservation = await ctx.db
    .query("usageReservations")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .unique();
  if (!reservation) return;
  const row = await account(ctx, reservation.teamId);
  if (!row) throw new ConvexError("Usage account unavailable.");
  const target =
    step === "release"
      ? reservation.consumed
      : step === 0
        ? Math.ceil(reservation.total / 2)
        : reservation.total;
  const charge = Math.max(0, target - reservation.consumed);
  const release = step === "release" ? reservation.remaining : charge;
  if (charge > reservation.remaining) throw new ConvexError("Usage reservation exhausted.");
  await ctx.db.patch(reservation._id, {
    consumed: reservation.consumed + charge,
    remaining: reservation.remaining - release,
  });
  await ctx.db.patch(row._id, { used: row.used + charge, reserved: row.reserved - release });
}

export const status = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await membership(ctx, args.teamId);
    const row = await account(ctx, args.teamId);
    if (row) return row;
    // Billing on: no row means no entitlement. Billing off: keep the self-hosted fixture.
    return {
      teamId: args.teamId,
      enabled: !billingEnabled(),
      limit: billingEnabled() ? 0 : 10000,
      used: 0,
      reserved: 0,
      expiresAt: 0,
      sequence: 0,
    };
  },
});

// A verified payment adapter may call this internally; the browser cannot grant entitlements.
export const billingEvent = internalMutation({
  args: {
    eventId: v.string(),
    teamId: v.id("teams"),
    sequence: v.number(),
    enabled: v.boolean(),
    limit: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(args.eventId) ||
      !Number.isSafeInteger(args.sequence) ||
      args.sequence < 1 ||
      !Number.isSafeInteger(args.limit) ||
      args.limit < 0 ||
      args.limit > 1_000_000_000 ||
      !Number.isSafeInteger(args.expiresAt) ||
      args.expiresAt < 0
    )
      throw new ConvexError("Invalid billing event.");
    if (!(await ctx.db.get(args.teamId))) throw new ConvexError("Team unavailable.");
    const prior = await ctx.db
      .query("billingEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (prior) {
      if (
        prior.teamId !== args.teamId ||
        prior.sequence !== args.sequence ||
        prior.enabled !== args.enabled ||
        prior.limit !== args.limit ||
        prior.expiresAt !== args.expiresAt
      )
        throw new ConvexError("Billing event conflicts.");
      return false;
    }
    await ctx.db.insert("billingEvents", args);
    const row = await account(ctx, args.teamId);
    if (row && args.sequence <= row.sequence) return false;
    if (row)
      await ctx.db.patch(row._id, {
        enabled: args.enabled,
        limit: args.limit,
        expiresAt: args.expiresAt,
        sequence: args.sequence,
      });
    else
      await ctx.db.insert("serviceAccounts", {
        teamId: args.teamId,
        enabled: args.enabled,
        limit: args.limit,
        expiresAt: args.expiresAt,
        sequence: args.sequence,
        used: 0,
        reserved: 0,
      });
    return true;
  },
});

export const exportData = query({
  args: { teamId: v.id("teams"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const member = await membership(ctx, args.teamId);
    if (args.paginationOpts.numItems > 50)
      throw new ConvexError("Export pages support up to 50 jobs.");
    const result = await ctx.db
      .query("publishJobs")
      .withIndex("by_team_user_request", (q) => q.eq("teamId", args.teamId).eq("user", member.user))
      .paginate(args.paginationOpts);
    const consent = await ctx.db
      .query("aiConsents")
      .withIndex("by_team_user", (q) => q.eq("teamId", args.teamId).eq("user", member.user))
      .unique();
    return { ...result, consent, usage: await account(ctx, args.teamId) };
  },
});

export const deleteJob = mutation({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row) return;
    if (row.user !== (await identity(ctx)).tokenIdentifier)
      throw new ConvexError("Job unavailable.");
    await membership(ctx, row.teamId);
    if (row.status === "running" || row.status === "queued")
      throw new ConvexError("Cancel the job before deleting it.");
    await settle(ctx, row._id, "release");
    await ctx.db.patch(row._id, {
      deletedAt: Date.now(),
      status: "cancelled",
      artifacts: [],
      payload: { title: "[deleted]", description: "", words: [], chapters: [] },
    });
  },
});

export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    let count = 0;
    const cutoff = Date.now() - 30 * 86400000;
    for (const terminalStatus of ["ready", "failed", "cancelled"] as const) {
      const rows = await ctx.db
        .query("publishJobs")
        .withIndex("by_status", (q) =>
          q.eq("status", terminalStatus).eq("deletedAt", undefined).lt("_creationTime", cutoff),
        )
        .take(20);
      for (const row of rows) {
        await settle(ctx, row._id, "release");
        await ctx.db.patch(row._id, {
          deletedAt: Date.now(),
          status: "cancelled",
          artifacts: [],
          payload: { title: "[deleted]", description: "", words: [], chapters: [] },
        });
        count++;
      }
    }
    return count;
  },
});
