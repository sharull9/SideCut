import { ConvexError, v } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation, query } from "./model";
import type { QueryCtx } from "./model";
import { internalMutation, internalQuery } from "./_generated/server";
import { mediaAccess } from "./library";
import { identity, membership } from "./access";
import { reviewWorkflow } from "./schema";

export async function tokenHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ConvexError("Share unavailable.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function grantAccess(ctx: QueryCtx, grantId: GenericId<"shareGrants">) {
  const grant = await ctx.db.get(grantId);
  if (!grant || grant.revoked || grant.expiresAt <= Date.now())
    throw new ConvexError("Share unavailable.");
  const version = await ctx.db.get(grant.versionId);
  const media = version ? await ctx.db.get(version.mediaId) : null;
  if (!version || version.status !== "ready" || !version.playbackKey || !media || media.archived)
    throw new ConvexError("Share unavailable.");
  if (grant.private) await membership(ctx, media.teamId);
  return { grant, version, media };
}

async function sessionAccess(ctx: QueryCtx, token: string) {
  const hash = await tokenHash(token);
  const session = await ctx.db
    .query("guestSessions")
    .withIndex("by_token", (q) => q.eq("tokenHash", hash))
    .unique();
  if (!session || session.expiresAt <= Date.now()) throw new ConvexError("Share unavailable.");
  const access = await grantAccess(ctx, session.grantId);
  if (access.grant.private && session.user !== (await identity(ctx)).tokenIdentifier)
    throw new ConvexError("Share unavailable.");
  return { ...access, session };
}

export const create = internalMutation({
  args: {
    versionId: v.id("mediaVersions"),
    tokenHash: v.string(),
    private: v.boolean(),
    comments: v.boolean(),
    downloads: v.boolean(),
    expiresAt: v.number(),
    passwordSalt: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.status !== "ready") throw new ConvexError("Ready version required.");
    const media = await mediaAccess(ctx, version.mediaId, true);
    if (media.archived) throw new ConvexError("Media archived.");
    if (
      !Number.isFinite(args.expiresAt) ||
      args.expiresAt <= Date.now() ||
      args.expiresAt > Date.now() + 90 * 86400000
    )
      throw new ConvexError("Expiry must be within 90 days.");
    return ctx.db.insert("shareGrants", {
      ...args,
      createdBy: (await identity(ctx)).tokenIdentifier,
      revoked: false,
      openWindow: Date.now(),
      openAttempts: 0,
    });
  },
});

export const reserveOpen = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("shareGrants")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!grant) throw new ConvexError("Share unavailable.");
    await grantAccess(ctx, grant._id);
    const sameWindow = Date.now() - grant.openWindow < 60000;
    if (sameWindow && grant.openAttempts >= 30)
      throw new ConvexError("Too many attempts. Try again later.");
    await ctx.db.patch(grant._id, {
      openWindow: sameWindow ? grant.openWindow : Date.now(),
      openAttempts: sameWindow ? grant.openAttempts + 1 : 1,
    });
    return grant;
  },
});

export const openSession = internalMutation({
  args: { grantId: v.id("shareGrants"), tokenHash: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { grant } = await grantAccess(ctx, args.grantId);
    const name = args.name.trim();
    if (!name || name.length > 100) throw new ConvexError("Enter a name of 1–100 characters.");
    return ctx.db.insert("guestSessions", {
      ...args,
      name,
      ...(grant.private ? { user: (await identity(ctx)).tokenIdentifier } : {}),
      expiresAt: Math.min(grant.expiresAt, Date.now() + 86400000),
      lastSeen: Date.now(),
    });
  },
});

export const list = query({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    const grants = await ctx.db
      .query("shareGrants")
      .withIndex("by_version", (q) => q.eq("versionId", args.versionId))
      .take(100);
    return grants.map((g) => ({
      id: g._id,
      private: g.private,
      comments: g.comments,
      downloads: g.downloads,
      expiresAt: g.expiresAt,
      revoked: g.revoked,
      passwordProtected: Boolean(g.passwordHash),
    }));
  },
});

export const revoke = mutation({
  args: { grantId: v.id("shareGrants") },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    const version = grant ? await ctx.db.get(grant.versionId) : null;
    if (!grant || !version) throw new ConvexError("Share unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    await ctx.db.patch(grant._id, { revoked: true });
  },
});

export const view = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { grant, version, media } = await sessionAccess(ctx, args.sessionToken);
    const comments = grant.comments
      ? await ctx.db
          .query("guestComments")
          .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
          .order("desc")
          .take(500)
      : [];
    const feedback = await Promise.all(
      comments.map(async (c) => ({
        id: c._id,
        parentId: c.parentId,
        at: c.at,
        end: c.end,
        body: c.body,
        resolved: c.resolved,
        author: (await ctx.db.get(c.sessionId))?.name ?? "Guest",
        createdAt: c._creationTime,
      })),
    );
    const sessions = await ctx.db
      .query("guestSessions")
      .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
      .order("desc")
      .take(100);
    return {
      title: media.name,
      version: version.number,
      workflow: version.workflow ?? "review",
      workflowRevision: version.workflowRevision ?? 0,
      downloads: grant.downloads,
      commentsAllowed: grant.comments,
      feedback,
      presence: sessions
        .filter((s) => s.lastSeen > Date.now() - 45000 && s.expiresAt > Date.now())
        .map((s) => ({ name: s.name, lastSeen: s.lastSeen })),
    };
  },
});

export const heartbeat = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { session } = await sessionAccess(ctx, args.sessionToken);
    if (Date.now() - session.lastSeen >= 10000)
      await ctx.db.patch(session._id, { lastSeen: Date.now() });
  },
});

export const comment = mutation({
  args: {
    sessionToken: v.string(),
    requestId: v.string(),
    body: v.string(),
    at: v.number(),
    end: v.optional(v.number()),
    parentId: v.optional(v.id("guestComments")),
  },
  handler: async (ctx, args) => {
    const { grant, version, session } = await sessionAccess(ctx, args.sessionToken);
    if (!grant.comments) throw new ConvexError("Comments disabled.");
    const body = args.body.trim();
    if (
      !body ||
      body.length > 5000 ||
      !args.requestId ||
      args.requestId.length > 100 ||
      !Number.isFinite(args.at) ||
      args.at < 0 ||
      (args.end !== undefined && (!Number.isFinite(args.end) || args.end < args.at))
    )
      throw new ConvexError("Invalid comment.");
    const parent = args.parentId ? await ctx.db.get(args.parentId) : null;
    if (
      args.parentId &&
      (!parent ||
        parent.grantId !== grant._id ||
        parent.versionId !== version._id ||
        parent.parentId)
    )
      throw new ConvexError("Thread unavailable.");
    const prior = await ctx.db
      .query("guestComments")
      .withIndex("by_request", (q) =>
        q.eq("sessionId", session._id).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.body !== body ||
        prior.at !== args.at ||
        prior.end !== args.end ||
        prior.parentId !== args.parentId
      )
        throw new ConvexError("Comment request conflicts.");
      return prior._id;
    }
    const existing = await ctx.db
      .query("guestComments")
      .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
      .take(500);
    if (existing.length >= 500) throw new ConvexError("Review reached the 500-comment limit.");
    return ctx.db.insert("guestComments", {
      grantId: grant._id,
      versionId: version._id,
      sessionId: session._id,
      requestId: args.requestId,
      body,
      at: args.at,
      ...(args.end === undefined ? {} : { end: args.end }),
      ...(args.parentId === undefined ? {} : { parentId: args.parentId }),
      resolved: false,
    });
  },
});

export const resolve = mutation({
  args: { sessionToken: v.string(), commentId: v.id("guestComments"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const { grant, session } = await sessionAccess(ctx, args.sessionToken);
    const thread = await ctx.db.get(args.commentId);
    if (
      !grant.comments ||
      !thread ||
      thread.grantId !== grant._id ||
      thread.parentId ||
      thread.sessionId !== session._id
    )
      throw new ConvexError("Thread unavailable.");
    await ctx.db.patch(thread._id, { resolved: args.resolved });
  },
});

export const workflow = mutation({
  args: { versionId: v.id("mediaVersions"), expectedRevision: v.number(), state: reviewWorkflow },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    if ((version.workflowRevision ?? 0) !== args.expectedRevision)
      throw new ConvexError("Review state changed. Refresh and retry.");
    await ctx.db.patch(version._id, {
      workflow: args.state,
      workflowRevision: args.expectedRevision + 1,
    });
  },
});

export const delivery = internalQuery({
  args: { sessionToken: v.string(), download: v.boolean() },
  handler: async (ctx, args) => {
    const { grant, version, session } = await sessionAccess(ctx, args.sessionToken);
    if (args.download && !grant.downloads) throw new ConvexError("Downloads disabled.");
    const expiresIn = Math.min(
      60,
      Math.floor((Math.min(grant.expiresAt, session.expiresAt) - Date.now()) / 1000),
    );
    if (expiresIn < 1) throw new ConvexError("Share unavailable.");
    return {
      key: args.download ? version.objectKey : version.playbackKey,
      expiresIn,
    };
  },
});
