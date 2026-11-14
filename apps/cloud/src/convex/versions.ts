import { v, ConvexError } from "convex/values";
import { mutation, query } from "./model";
import { internalMutation, internalQuery } from "./_generated/server";
import { mediaAccess } from "./library";

export const begin = mutation({
  args: {
    mediaId: v.id("media"),
    requestId: v.string(),
    snapshot: v.string(),
    expectedBytes: v.number(),
    partCount: v.number(),
  },
  handler: async (ctx, args) => {
    const media = await mediaAccess(ctx, args.mediaId, true);
    if (media.archived) throw new ConvexError("Media archived.");
    if (
      !args.requestId ||
      args.requestId.length > 100 ||
      args.snapshot.length > 65536 ||
      !args.snapshot
    )
      throw new ConvexError("Invalid version metadata.");
    if (
      !Number.isSafeInteger(args.expectedBytes) ||
      args.expectedBytes < 1 ||
      args.expectedBytes > 5e10 ||
      !Number.isInteger(args.partCount) ||
      args.partCount < 1 ||
      args.partCount > 10000
    )
      throw new ConvexError("Invalid transfer size.");
    const prior = await ctx.db
      .query("mediaVersions")
      .withIndex("by_request", (q) => q.eq("mediaId", args.mediaId).eq("requestId", args.requestId))
      .unique();
    if (prior) {
      if (
        prior.snapshot !== args.snapshot ||
        prior.expectedBytes !== args.expectedBytes ||
        prior.partCount !== args.partCount
      )
        throw new ConvexError("Request conflicts with existing version.");
      return prior._id;
    }
    const versionId = await ctx.db.insert("mediaVersions", {
      ...args,
      number: media.nextVersion,
      status: "uploading",
      attempt: 1,
      objectKey: `${media.teamId}/${args.mediaId}/${media.nextVersion}/source`,
    });
    await ctx.db.patch(media._id, { nextVersion: media.nextVersion + 1 });
    return versionId;
  },
});

const MAX_BYTES = 5e10;
const MAX_PARTS = 10000;

/** Start a version whose bytes arrive while it is still being recorded. */
export const beginStream = mutation({
  args: { mediaId: v.id("media"), requestId: v.string(), snapshot: v.string() },
  handler: async (ctx, args) => {
    const media = await mediaAccess(ctx, args.mediaId, true);
    if (media.archived) throw new ConvexError("Media archived.");
    if (
      !args.requestId ||
      args.requestId.length > 100 ||
      args.snapshot.length > 65536 ||
      !args.snapshot
    )
      throw new ConvexError("Invalid version metadata.");
    const prior = await ctx.db
      .query("mediaVersions")
      .withIndex("by_request", (q) => q.eq("mediaId", args.mediaId).eq("requestId", args.requestId))
      .unique();
    if (prior) {
      if (prior.snapshot !== args.snapshot)
        throw new ConvexError("Request conflicts with existing version.");
      return prior._id;
    }
    const versionId = await ctx.db.insert("mediaVersions", {
      ...args,
      // Upper bounds until sealed: part URLs may be signed for any part up to the limit.
      expectedBytes: MAX_BYTES,
      partCount: MAX_PARTS,
      open: true,
      number: media.nextVersion,
      status: "uploading",
      attempt: 1,
      objectKey: `${media.teamId}/${args.mediaId}/${media.nextVersion}/source`,
    });
    await ctx.db.patch(media._id, { nextVersion: media.nextVersion + 1 });
    return versionId;
  },
});

/** Fix the final size of a recorded version once every part has been sent. */
export const seal = mutation({
  args: { versionId: v.id("mediaVersions"), expectedBytes: v.number(), partCount: v.number() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    await mediaAccess(ctx, version.mediaId, true);
    if (
      !Number.isSafeInteger(args.expectedBytes) ||
      args.expectedBytes < 1 ||
      args.expectedBytes > MAX_BYTES ||
      !Number.isInteger(args.partCount) ||
      args.partCount < 1 ||
      args.partCount > MAX_PARTS
    )
      throw new ConvexError("Invalid transfer size.");
    if (!version.open) {
      // A repeated seal after a lost response is accepted; a different size is not.
      if (version.expectedBytes === args.expectedBytes && version.partCount === args.partCount)
        return;
      throw new ConvexError("Version is already sealed.");
    }
    if (version.status !== "uploading") throw new ConvexError("Upload unavailable.");
    await ctx.db.patch(version._id, {
      expectedBytes: args.expectedBytes,
      partCount: args.partCount,
      open: false,
    });
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

// Editors download the original upload; it exists once the upload completed.
export const source = internalQuery({
  args: { mediaId: v.id("media") },
  handler: async (ctx, args) => {
    const media = await mediaAccess(ctx, args.mediaId);
    if (media.archived) throw new ConvexError("Media archived.");
    const versions = await ctx.db
      .query("mediaVersions")
      .withIndex("by_media", (q) => q.eq("mediaId", media._id))
      .order("desc")
      .take(100);
    const version = versions.find(
      (item) => item.status === "processing" || item.status === "ready",
    );
    if (!version) throw new ConvexError("Source unavailable.");
    return { key: version.objectKey, name: media.name, snapshot: version.snapshot };
  },
});

export const transfer = internalQuery({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version unavailable.");
    const media = await mediaAccess(ctx, version.mediaId, true);
    if (media.archived) throw new ConvexError("Media archived.");
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
