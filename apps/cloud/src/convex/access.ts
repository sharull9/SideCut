import { ConvexError } from "convex/values";
import type { GenericId } from "convex/values";
import type { QueryCtx } from "./model";

export async function identity(ctx: QueryCtx) {
  const user = await ctx.auth.getUserIdentity();
  if (!user) throw new ConvexError("Sign in required.");
  return user;
}

export async function membership(ctx: QueryCtx, teamId: GenericId<"teams">) {
  const user = await identity(ctx);
  const member = await ctx.db
    .query("memberships")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("user", user.tokenIdentifier))
    .unique();
  if (!member) throw new ConvexError("Team access denied.");
  return member;
}

export async function manageTeam(ctx: QueryCtx, teamId: GenericId<"teams">) {
  const member = await membership(ctx, teamId);
  if (member.role !== "owner" && member.role !== "admin")
    throw new ConvexError("Team administrator required.");
  return member;
}
