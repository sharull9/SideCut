import { v, ConvexError } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation, query } from "./model";
import type { MutationCtx, QueryCtx } from "./model";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { creatorAccess, mediaAccess, name as mediaName } from "./library";
import { requireSubscription } from "./billing";

type VersionInput = {
  requestId: string;
  snapshot: string;
  expectedBytes: number;
  partCount: number;
  fileName?: string;
};

function validateVersionInput(input: VersionInput) {
  if (
    !input.requestId ||
    input.requestId.length > 100 ||
    input.snapshot.length > 65536 ||
    !input.snapshot
  )
    throw new ConvexError("Invalid version metadata.");
  if (
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes < 1 ||
    input.expectedBytes > 5e10 ||
    !Number.isInteger(input.partCount) ||
    input.partCount < 1 ||
    input.partCount > 10000
  )
    throw new ConvexError("Invalid transfer size.");
}

function validateFileName(value: string) {
  if (value.length < 1 || value.length > 255 || !value.trim() || /[\\/]/.test(value))
    throw new ConvexError("Invalid file name.");
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) throw new ConvexError("Invalid file name.");
  }
}

// Shared gate for every paid upload path: access, not archived, then subscription.
async function uploadTarget(ctx: QueryCtx, mediaId: GenericId<"media">) {
  const media = await mediaAccess(ctx, mediaId, true);
  if (media.archived) throw new ConvexError("Media archived.");
  await requireSubscription(ctx, media.teamId);
  return media;
}

// Idempotent by (mediaId, requestId). Returns the existing or newly inserted version id.
async function ensureVersion(
  ctx: MutationCtx,
  media: Pick<Doc<"media">, "_id" | "teamId" | "nextVersion" | "archived">,
  input: VersionInput,
) {
  const prior = await ctx.db
    .query("mediaVersions")
    .withIndex("by_request", (q) => q.eq("mediaId", media._id).eq("requestId", input.requestId))
    .unique();
  if (prior) {
    if (
      prior.snapshot !== input.snapshot ||
      prior.expectedBytes !== input.expectedBytes ||
      prior.partCount !== input.partCount ||
      prior.fileName !== input.fileName
    )
      throw new ConvexError("Request conflicts with existing version.");
    return prior._id;
  }
  if (media.archived) throw new ConvexError("Media archived.");
  const versionId = await ctx.db.insert("mediaVersions", {
    mediaId: media._id,
    requestId: input.requestId,
    snapshot: input.snapshot,
    expectedBytes: input.expectedBytes,
    partCount: input.partCount,
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    number: media.nextVersion,
    status: "uploading",
    attempt: 1,
    objectKey: `${media.teamId}/${media._id}/${media.nextVersion}/source`,
  });
  await ctx.db.patch(media._id, { nextVersion: media.nextVersion + 1 });
  return versionId;
}

export const begin = mutation({
  args: {
    mediaId: v.id("media"),
    requestId: v.string(),
    snapshot: v.string(),
    expectedBytes: v.number(),
    partCount: v.number(),
  },
  handler: async (ctx, args) => {
    const media = await uploadTarget(ctx, args.mediaId);
    validateVersionInput(args);
    return ensureVersion(ctx, media, args);
  },
});

// Creates media (when no mediaId) and the first upload version in one transaction.
export const beginUpload = mutation({
  args: {
    teamId: v.id("teams"),
    mediaId: v.optional(v.id("media")),
    name: v.string(),
    folderId: v.optional(v.id("folders")),
    requestId: v.string(),
    fileName: v.string(),
    snapshot: v.string(),
    expectedBytes: v.number(),
    partCount: v.number(),
  },
  handler: async (ctx, args) => {
    const input: VersionInput = {
      requestId: args.requestId,
      snapshot: args.snapshot,
      expectedBytes: args.expectedBytes,
      partCount: args.partCount,
      fileName: args.fileName,
    };
    if (args.mediaId) {
      const media = await uploadTarget(ctx, args.mediaId);
      if (media.teamId !== args.teamId) throw new ConvexError("Media unavailable.");
      validateFileName(args.fileName);
      validateVersionInput(input);
      const versionId = await ensureVersion(ctx, media, input);
      return { mediaId: media._id, versionId };
    }

    await creatorAccess(ctx, args.teamId, args.folderId);
    await requireSubscription(ctx, args.teamId);
    validateFileName(args.fileName);
    validateVersionInput(input);
    const title = mediaName(args.name);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_team_request", (q) =>
        q.eq("teamId", args.teamId).eq("createRequestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.name !== title || existing.folderId !== args.folderId)
        throw new ConvexError("Request conflicts with existing media.");
      const versionId = await ensureVersion(ctx, existing, input);
      return { mediaId: existing._id, versionId };
    }
    const mediaId = await ctx.db.insert("media", {
      teamId: args.teamId,
      name: title,
      ...(args.folderId === undefined ? {} : { folderId: args.folderId }),
      archived: false,
      nextVersion: 1,
      createRequestId: args.requestId,
    });
    const versionId = await ensureVersion(
      ctx,
      { _id: mediaId, teamId: args.teamId, nextVersion: 1, archived: false },
      input,
    );
    return { mediaId, versionId };
  },
});

export const list = query({
  args: { mediaId: v.id("media") },
  handler: async (ctx, args) => {
    await mediaAccess(ctx, args.mediaId);
    return ctx.db
      .query("mediaVersions")
      .withIndex("by_media", (q) => q.eq("mediaId", args.mediaId))
      .order("desc")
      .take(100);
  },
});

// Only trusted storage/processing adapters may acknowledge bytes or publish output.
export const recordPart = internalMutation({
  args: { versionId: v.id("mediaVersions"), part: v.number(), etag: v.string(), bytes: v.number() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.status !== "uploading") throw new ConvexError("Upload unavailable.");
    if (
      !Number.isInteger(args.part) ||
      args.part < 1 ||
      args.part > version.partCount ||
      !Number.isSafeInteger(args.bytes) ||
      args.bytes < 1 ||
      args.bytes > version.expectedBytes ||
      !args.etag ||
      args.etag.length > 200
    )
      throw new ConvexError("Invalid part.");
    const prior = await ctx.db
      .query("uploadParts")
      .withIndex("by_version_part", (q) => q.eq("versionId", args.versionId).eq("part", args.part))
      .unique();
    if (prior) {
      if (prior.etag !== args.etag || prior.bytes !== args.bytes)
        throw new ConvexError("Part conflicts with committed upload.");
      return;
    }
    await ctx.db.insert("uploadParts", args);
  },
});

export const uploaded = internalMutation({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    if (version.status === "processing" || version.status === "ready") return;
    if (version.status !== "uploading") throw new ConvexError("Upload unavailable.");
    const parts = await ctx.db
      .query("uploadParts")
      .withIndex("by_version_part", (q) => q.eq("versionId", args.versionId))
      .collect();
    if (
      parts.length !== version.partCount ||
      parts.reduce((sum, p) => sum + p.bytes, 0) !== version.expectedBytes
    )
      throw new ConvexError("Upload incomplete.");
    await ctx.db.patch(version._id, { status: "processing" });
  },
});

export const retryProcessing = mutation({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    if (version.status !== "failed") throw new ConvexError("Only failed processing can retry.");
    await ctx.db.patch(version._id, {
      status: "processing",
      attempt: version.attempt + 1,
      error: undefined,
    });
  },
});

export const processed = internalMutation({
  args: {
    versionId: v.id("mediaVersions"),
    attempt: v.number(),
    result: v.union(
      v.object({
        status: v.literal("ready"),
        playbackKey: v.string(),
        thumbnailKey: v.optional(v.string()),
      }),
      v.object({ status: v.literal("failed"), error: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    if (version.attempt !== args.attempt || version.status !== "processing") return;
    const media = await ctx.db.get(version.mediaId);
    if (!media) throw new ConvexError("Media unavailable.");
    if (args.result.status === "failed") {
      await ctx.db.patch(version._id, {
        status: "failed",
        error: args.result.error.slice(0, 1000),
      });
      return;
    }
    const prefix = `${media.teamId}/${media._id}/${version.number}/attempt-${version.attempt}/`;
    if (
      !args.result.playbackKey.startsWith(prefix) ||
      (args.result.thumbnailKey && !args.result.thumbnailKey.startsWith(prefix))
    )
      throw new ConvexError("Output outside version namespace.");
    await ctx.db.patch(version._id, args.result);
    const current = media.readyVersionId ? await ctx.db.get(media.readyVersionId) : null;
    if (!current || current.number < version.number)
      await ctx.db.patch(media._id, { readyVersionId: version._id });
  },
});

// A serving adapter must call this on every object request; never cache membership.
export const playback = internalQuery({
  args: { mediaId: v.id("media"), versionId: v.optional(v.id("mediaVersions")) },
  handler: async (ctx, args) => {
    const media = await mediaAccess(ctx, args.mediaId);
    if (media.archived) throw new ConvexError("Media archived.");
    const id = args.versionId ?? media.readyVersionId;
    const version = id ? await ctx.db.get(id) : null;
    if (
      !version ||
      version.mediaId !== media._id ||
      version.status !== "ready" ||
      !version.playbackKey
    )
      throw new ConvexError("Playback unavailable.");
    return { key: version.playbackKey, thumbnailKey: version.thumbnailKey, versionId: version._id };
  },
});

// Original upload for download. Same access rules as playback, but no subscription gate:
// downloads stay available after a subscription lapses.
export const original = internalQuery({
  args: { mediaId: v.id("media"), versionId: v.optional(v.id("mediaVersions")) },
  handler: async (ctx, args) => {
    const media = await mediaAccess(ctx, args.mediaId);
    if (media.archived) throw new ConvexError("Media archived.");
    const id = args.versionId ?? media.readyVersionId;
    const version = id ? await ctx.db.get(id) : null;
    if (
      !version ||
      version.mediaId !== media._id ||
      (version.status !== "processing" && version.status !== "ready")
    )
      throw new ConvexError("Original unavailable.");
    return {
      objectKey: version.objectKey,
      fileName: version.fileName ?? null,
      mediaName: media.name,
      number: version.number,
    };
  },
});

export const transfer = internalQuery({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    const media = await mediaAccess(ctx, version.mediaId, true);
    if (media.archived) throw new ConvexError("Media archived.");
    await requireSubscription(ctx, media.teamId);
    const parts = await ctx.db
      .query("uploadParts")
      .withIndex("by_version_part", (q) => q.eq("versionId", args.versionId))
      .collect();
    return { version, parts };
  },
});

export const attachUpload = internalMutation({
  args: { versionId: v.id("mediaVersions"), uploadId: v.string() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.status !== "uploading") throw new ConvexError("Upload unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    if (version.uploadId) return version.uploadId;
    await ctx.db.patch(version._id, { uploadId: args.uploadId });
    return args.uploadId;
  },
});

// Marks an in-flight upload cancelled. Orphaned media created by beginUpload is deleted with its
// cancelled versions and parts; media that still has a live version is kept.
export const cancelUpload = internalMutation({
  args: {
    versionId: v.id("mediaVersions"),
    reason: v.union(v.literal("cancelled"), v.literal("stale")),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Upload unavailable.");
    const uploadId = version.uploadId ?? null;
    if (version.status !== "uploading")
      return { cancelled: false, objectKey: version.objectKey, uploadId };
    await ctx.db.patch(version._id, { status: "cancelled" });
    const media = await ctx.db.get(version.mediaId);
    if (media?.createRequestId) {
      const siblings = await ctx.db
        .query("mediaVersions")
        .withIndex("by_media", (q) => q.eq("mediaId", media._id))
        .collect();
      if (siblings.every((s) => s.status === "cancelled")) {
        for (const sibling of siblings) {
          const parts = await ctx.db
            .query("uploadParts")
            .withIndex("by_version_part", (q) => q.eq("versionId", sibling._id))
            .collect();
          for (const part of parts) await ctx.db.delete(part._id);
          await ctx.db.delete(sibling._id);
        }
        await ctx.db.delete(media._id);
      }
    }
    return { cancelled: true, objectKey: version.objectKey, uploadId };
  },
});

export const authorizeCancel = internalQuery({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Upload unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    return {
      versionId: version._id,
      status: version.status,
      objectKey: version.objectKey,
      uploadId: version.uploadId ?? null,
    };
  },
});

// Abandoned uploads for the sweeper. Oldest-first is not guaranteed; the cleanup action reschedules itself while full batches make progress.
export const staleUploads = internalQuery({
  args: { olderThan: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const max = Math.min(Math.floor(args.limit), 20);
    if (!(max > 0)) return [];
    const rows = await ctx.db
      .query("mediaVersions")
      .withIndex("by_status", (q) =>
        q.eq("status", "uploading").lt("_creationTime", args.olderThan),
      )
      .take(max);
    return rows.map((row) => ({
      _id: row._id,
      objectKey: row.objectKey,
      uploadId: row.uploadId ?? null,
    }));
  },
});
