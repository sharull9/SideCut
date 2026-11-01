import { v, ConvexError } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation, query, type QueryCtx } from "./model";
import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { entitled, reserve, settle } from "./accounts";
import { identity, membership } from "./access";
import { mediaAccess } from "./library";
import { publishPayload } from "./schema";
import { validatePublishPayload, publishPackStep, publishPayloadKey } from "./publishPack";

export const capabilities = query({
  args: {},
  handler: () => ({
    version: 1,
    operation: "publish-pack",
    aiEnabled: false,
    publishesExternally: false,
    consentRequired: true,
    maxPayloadCharacters: 50000,
    maxWords: 1000,
    outputs: ["transcript.txt", "captions.srt", "metadata.json", "chapters.txt"],
  }),
});

async function allowed(
  ctx: QueryCtx,
  job: { teamId: GenericId<"teams">; user: string; consentGeneration: number },
) {
  const consent = await ctx.db
    .query("aiConsents")
    .withIndex("by_team_user", (q) => q.eq("teamId", job.teamId).eq("user", job.user))
    .unique();
  const member = await ctx.db
    .query("memberships")
    .withIndex("by_team_user", (q) => q.eq("teamId", job.teamId).eq("user", job.user))
    .unique();
  return (
    (await entitled(ctx, job.teamId)) &&
    !!member &&
    member.role !== "viewer" &&
    !!consent?.enabled &&
    consent.generation === job.consentGeneration
  );
}

export const consent = mutation({
  args: { teamId: v.id("teams"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const member = await membership(ctx, args.teamId);
    if (member.role === "viewer") throw new ConvexError("Editing access required.");
    const prior = await ctx.db
      .query("aiConsents")
      .withIndex("by_team_user", (q) => q.eq("teamId", args.teamId).eq("user", member.user))
      .unique();
    const generation = (prior?.generation ?? 0) + 1;
    if (prior?.enabled === args.enabled) return prior.generation;
    if (prior) await ctx.db.patch(prior._id, { enabled: args.enabled, generation });
    else await ctx.db.insert("aiConsents", { ...args, user: member.user, generation });
    return generation;
  },
});

export const start = mutation({
  args: { versionId: v.id("mediaVersions"), requestId: v.string(), payload: publishPayload },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.status !== "ready")
      throw new ConvexError("Ready source version required.");
    const media = await mediaAccess(ctx, version.mediaId, true);
    if (media.archived) throw new ConvexError("Media archived.");
    const user = (await identity(ctx)).tokenIdentifier;
    const grant = await ctx.db
      .query("aiConsents")
      .withIndex("by_team_user", (q) => q.eq("teamId", media.teamId).eq("user", user))
      .unique();
    if (!grant?.enabled) throw new ConvexError("Explicit processing consent required.");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(args.requestId))
      throw new ConvexError("Invalid request ID.");
    validatePublishPayload(args.payload);
    const prior = await ctx.db
      .query("publishJobs")
      .withIndex("by_user_request", (q) => q.eq("user", user).eq("requestId", args.requestId))
      .unique();
    if (prior?.deletedAt !== undefined)
      throw new ConvexError("Request retired. Use a new request ID.");
    if (prior) {
      if (
        prior.versionId !== args.versionId ||
        publishPayloadKey(prior.payload) !== publishPayloadKey(args.payload) ||
        prior.consentGeneration !== grant.generation
      )
        throw new ConvexError("Request conflicts with existing job.");
      return prior._id;
    }
    const jobId = await ctx.db.insert("publishJobs", {
      ...args,
      teamId: media.teamId,
      user,
      consentGeneration: grant.generation,
      status: "queued",
      attempt: 0,
      leaseUntil: 0,
      checkpoint: 0,
      artifacts: [],
    });
    await reserve(ctx, media.teamId, jobId, Math.max(1, args.payload.words.length));
    await ctx.scheduler.runAfter(0, internal.publishJobs.process, { jobId });
    return jobId;
  },
});

export const get = query({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.user !== (await identity(ctx)).tokenIdentifier)
      throw new ConvexError("Job unavailable.");
    await membership(ctx, job.teamId);
    const valid = await allowed(ctx, job);
    return {
      id: job._id,
      status: valid ? job.status : "cancelled",
      checkpoint: job.checkpoint,
      attempt: job.attempt,
      artifacts: valid && job.status === "ready" ? job.artifacts : [],
    };
  },
});

export const resume = mutation({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.user !== (await identity(ctx)).tokenIdentifier)
      throw new ConvexError("Job unavailable.");
    if (!(await allowed(ctx, job)))
      throw new ConvexError("Processing consent or editing access revoked.");
    if (job.status === "ready") return;
    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.attempt >= 3 ||
      (job.status === "running" && job.leaseUntil > Date.now())
    )
      throw new ConvexError("Job cannot be resumed.");
    await ctx.db.patch(job._id, { status: "queued", leaseUntil: 0 });
    await ctx.scheduler.runAfter(0, internal.publishJobs.process, args);
  },
});

export const cancel = mutation({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.user !== (await identity(ctx)).tokenIdentifier)
      throw new ConvexError("Job unavailable.");
    await membership(ctx, job.teamId);
    await settle(ctx, job._id, "release");
    await ctx.db.patch(job._id, { status: "cancelled", artifacts: [], leaseUntil: 0 });
  },
});

// Workers have internal-only authority and a fenced lease; clients cannot acknowledge results.
export const claim = internalMutation({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.status === "ready" ||
      job.status === "cancelled" ||
      (job.status === "running" && job.leaseUntil > Date.now())
    )
      return null;
    if (job.attempt >= 3) {
      await settle(ctx, job._id, "release");
      await ctx.db.patch(job._id, { status: "failed", leaseUntil: 0 });
      return null;
    }
    if (!(await allowed(ctx, job))) {
      await settle(ctx, job._id, "release");
      await ctx.db.patch(job._id, { status: "cancelled", artifacts: [], leaseUntil: 0 });
      return null;
    }
    const version = await ctx.db.get(job.versionId);
    const media = version ? await ctx.db.get(version.mediaId) : null;
    if (!version || version.status !== "ready" || !media || media.archived) {
      await settle(ctx, job._id, "release");
      await ctx.db.patch(job._id, { status: "failed", leaseUntil: 0 });
      return null;
    }
    const attempt = job.attempt + 1;
    await ctx.db.patch(job._id, { status: "running", attempt, leaseUntil: Date.now() + 30000 });
    return { ...job, attempt };
  },
});

export const checkpoint = internalMutation({
  args: { jobId: v.id("publishJobs"), attempt: v.number(), step: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.status !== "running" ||
      job.attempt !== args.attempt ||
      job.leaseUntil <= Date.now()
    )
      return false;
    if (!(await allowed(ctx, job))) {
      await settle(ctx, job._id, "release");
      await ctx.db.patch(job._id, { status: "cancelled", artifacts: [], leaseUntil: 0 });
      return false;
    }
    if (!Number.isInteger(args.step) || args.step < 0 || args.step > 1)
      throw new ConvexError("Invalid publish checkpoint.");
    if (args.step < job.checkpoint) return true;
    if (args.step !== job.checkpoint) throw new ConvexError("Out-of-order checkpoint.");
    const artifacts = [...job.artifacts, ...publishPackStep(job.payload, args.step)];
    await settle(ctx, job._id, args.step === 0 ? 0 : 1);
    await ctx.db.patch(job._id, {
      artifacts,
      checkpoint: args.step + 1,
      status: args.step === 1 ? "ready" : "running",
      leaseUntil: args.step === 1 ? 0 : Date.now() + 30000,
    });
    return true;
  },
});

export const process = internalAction({
  args: { jobId: v.id("publishJobs") },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runMutation(internal.publishJobs.claim, args);
    if (!job) return;
    for (let step = job.checkpoint; step < 2; step++) {
      if (
        !(await ctx.runMutation(internal.publishJobs.checkpoint, {
          ...args,
          attempt: job.attempt,
          step,
        }))
      )
        return;
    }
  },
});
