import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { GenericId } from "convex/values";
import { mutation, query } from "./model";
import type { QueryCtx } from "./model";
import { membership } from "./access";

export function name(value: string) {
  const result = value.trim();
  if (!result || result.length > 200) throw new ConvexError("Name must contain 1–200 characters.");
  return result;
}

export async function mediaAccess(ctx: QueryCtx, mediaId: GenericId<"media">, write = false) {
  const media = await ctx.db.get(mediaId);
  if (!media) throw new ConvexError("Media unavailable.");
  const member = await membership(ctx, media.teamId);
  if (write && member.role === "viewer") throw new ConvexError("Editing access required.");
  return media;
}

async function folderAccess(
  ctx: QueryCtx,
  teamId: GenericId<"teams">,
  folderId?: GenericId<"folders">,
) {
  if (!folderId) return;
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.teamId !== teamId) throw new ConvexError("Folder unavailable.");
}

/** Membership, editor role and folder scope required to create media in a team. */
export async function creatorAccess(
  ctx: QueryCtx,
  teamId: GenericId<"teams">,
  folderId?: GenericId<"folders">,
) {
  const member = await membership(ctx, teamId);
  if (member.role === "viewer") throw new ConvexError("Editing access required.");
  await folderAccess(ctx, teamId, folderId);
}

export const createFolder = mutation({
  args: { teamId: v.id("teams"), name: v.string() },
  handler: async (ctx, args) => {
    const member = await membership(ctx, args.teamId);
    if (member.role === "viewer") throw new ConvexError("Editing access required.");
    return ctx.db.insert("folders", { teamId: args.teamId, name: name(args.name) });
  },
});

export const folders = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await membership(ctx, args.teamId);
    return ctx.db
      .query("folders")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const create = mutation({
  args: { teamId: v.id("teams"), name: v.string(), folderId: v.optional(v.id("folders")) },
  handler: async (ctx, args) => {
    await creatorAccess(ctx, args.teamId, args.folderId);
    return ctx.db.insert("media", {
      ...args,
      name: name(args.name),
      archived: false,
      nextVersion: 1,
    });
  },
});

export const list = query({
  args: {
    teamId: v.id("teams"),
    folderId: v.optional(v.id("folders")),
    search: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    sort: v.union(v.literal("name"), v.literal("newest")),
  },
  handler: async (ctx, args) => {
    await membership(ctx, args.teamId);
    await folderAccess(ctx, args.teamId, args.folderId);
    const search = (args.search ?? "").trim().toLowerCase();
    if (search.length > 200) throw new ConvexError("Search too long.");
    // ponytail: bounded first library page; add cursor/search indexes before large tenant rollout.
    const records = await ctx.db
      .query("media")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .take(1000);
    return records
      .filter(
        (m) =>
          m.archived === (args.archived ?? false) &&
          (!args.folderId || m.folderId === args.folderId) &&
          m.name.toLowerCase().includes(search),
      )
      .sort((a, b) =>
        args.sort === "name"
          ? a.name.localeCompare(b.name) || a._creationTime - b._creationTime
          : b._creationTime - a._creationTime,
      );
  },
});

export const page = query({
  args: {
    teamId: v.id("teams"),
    folderId: v.optional(v.id("folders")),
    search: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    sort: v.union(v.literal("name"), v.literal("newest")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await membership(ctx, args.teamId);
    await folderAccess(ctx, args.teamId, args.folderId);
    const search = (args.search ?? "").trim();
    if (search.length > 200) throw new ConvexError("Search too long.");
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new ConvexError("Page size must be 1–100.");
    const archived = args.archived ?? false;
    if (search)
      return ctx.db
        .query("media")
        .withSearchIndex("search_name", (q) => {
          const scoped = q
            .search("name", search)
            .eq("teamId", args.teamId)
            .eq("archived", archived);
          return args.folderId ? scoped.eq("folderId", args.folderId) : scoped;
        })
        .paginate(args.paginationOpts);
    const records = ctx.db.query("media");
    const scoped = args.folderId
      ? args.sort === "name"
        ? records.withIndex("by_team_folder_archived_name", (q) =>
            q.eq("teamId", args.teamId).eq("folderId", args.folderId).eq("archived", archived),
          )
        : records.withIndex("by_team_folder_archived", (q) =>
            q.eq("teamId", args.teamId).eq("folderId", args.folderId).eq("archived", archived),
          )
      : args.sort === "name"
        ? records.withIndex("by_team_archived_name", (q) =>
            q.eq("teamId", args.teamId).eq("archived", archived),
          )
        : records.withIndex("by_team_archived", (q) =>
            q.eq("teamId", args.teamId).eq("archived", archived),
          );
    return scoped.order(args.sort === "name" ? "asc" : "desc").paginate(args.paginationOpts);
  },
});

export const bulk = mutation({
  args: {
    teamId: v.id("teams"),
    mediaIds: v.array(v.id("media")),
    operation: v.union(v.literal("move"), v.literal("archive"), v.literal("restore")),
    folderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const member = await membership(ctx, args.teamId);
    if (member.role === "viewer") throw new ConvexError("Editing access required.");
    if (!args.mediaIds.length || args.mediaIds.length > 100)
      throw new ConvexError("Select 1–100 items.");
    await folderAccess(ctx, args.teamId, args.folderId);
    for (const id of new Set(args.mediaIds)) {
      const media = await mediaAccess(ctx, id, true);
      if (media.teamId !== args.teamId) throw new ConvexError("Media unavailable.");
      await ctx.db.patch(
        id,
        args.operation === "move"
          ? { folderId: args.folderId }
          : { archived: args.operation === "archive" },
      );
    }
  },
});
