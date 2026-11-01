import { v, ConvexError } from "convex/values";
import { mutation, query } from "./model";
import { identity, membership, manageTeam } from "./access";
import { role, invitedRole } from "./schema";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await identity(ctx);
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("user", user.tokenIdentifier))
      .collect();
    return Promise.all(
      members.map(async (member) => ({ team: await ctx.db.get(member.teamId), role: member.role })),
    );
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await identity(ctx);
    const name = args.name.trim();
    if (!name || name.length > 100)
      throw new ConvexError("Team name must contain 1–100 characters.");
    const teamId = await ctx.db.insert("teams", { name });
    await ctx.db.insert("memberships", { teamId, user: user.tokenIdentifier, role: "owner" });
    return teamId;
  },
});

export const members = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await membership(ctx, teamId);
    return ctx.db
      .query("memberships")
      .withIndex("by_team_user", (q) => q.eq("teamId", teamId))
      .collect();
  },
});

export const invite = mutation({
  args: { teamId: v.id("teams"), email: v.string(), role: invitedRole },
  handler: async (ctx, args) => {
    const member = await manageTeam(ctx, args.teamId);
    if (args.role === "admin" && member.role !== "owner")
      throw new ConvexError("Only owners can invite administrators.");
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ConvexError("Enter a valid email address.");
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    if (
      existing.some((i) => i.email === email && i.status === "pending" && i.expiresAt > Date.now())
    )
      throw new ConvexError("An invitation is already pending.");
    return ctx.db.insert("invitations", {
      teamId: args.teamId,
      email,
      role: args.role,
      createdBy: member.user,
      expiresAt: Date.now() + 7 * 86400000,
      status: "pending",
    });
  },
});

export const invitations = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await manageTeam(ctx, teamId);
    return ctx.db
      .query("invitations")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
  },
});

export const pendingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const user = await identity(ctx);
    if (user.emailVerified !== true || !user.email) return [];
    const email = user.email.toLowerCase();
    const pending = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return pending.filter((i) => i.status === "pending" && i.expiresAt > Date.now());
  },
});

export const accept = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const user = await identity(ctx);
    const invitation = await ctx.db.get(invitationId);
    if (
      !invitation ||
      invitation.status !== "pending" ||
      invitation.expiresAt <= Date.now() ||
      user.emailVerified !== true ||
      user.email?.toLowerCase() !== invitation.email
    )
      throw new ConvexError("Invitation unavailable.");
    const inviter = await ctx.db
      .query("memberships")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", invitation.teamId).eq("user", invitation.createdBy),
      )
      .unique();
    if (
      !inviter ||
      (inviter.role !== "owner" && inviter.role !== "admin") ||
      (invitation.role === "admin" && inviter.role !== "owner")
    )
      throw new ConvexError("Invitation unavailable.");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", invitation.teamId).eq("user", user.tokenIdentifier),
      )
      .unique();
    if (!existing)
      await ctx.db.insert("memberships", {
        teamId: invitation.teamId,
        user: user.tokenIdentifier,
        role: invitation.role,
      });
    await ctx.db.patch(invitationId, { status: "accepted" });
    return invitation.teamId;
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new ConvexError("Invitation unavailable.");
    const actor = await manageTeam(ctx, invitation.teamId);
    if (invitation.role === "admin" && actor.role !== "owner")
      throw new ConvexError("Only owners can revoke administrator invitations.");
    await ctx.db.patch(invitationId, { status: "revoked" });
  },
});

export const setRole = mutation({
  args: { membershipId: v.id("memberships"), role },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.membershipId);
    if (!target) throw new ConvexError("Membership unavailable.");
    const actor = await manageTeam(ctx, target.teamId);
    if (actor.role !== "owner") throw new ConvexError("Only owners can change roles.");
    if (target.role === "owner" && args.role !== "owner") {
      const owners = await ctx.db
        .query("memberships")
        .withIndex("by_team_user", (q) => q.eq("teamId", target.teamId))
        .collect();
      if (owners.filter((m) => m.role === "owner").length < 2)
        throw new ConvexError("A team must retain an owner.");
    }
    await ctx.db.patch(target._id, { role: args.role });
  },
});

export const removeMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    const target = await ctx.db.get(membershipId);
    if (!target) throw new ConvexError("Membership unavailable.");
    const actor = await manageTeam(ctx, target.teamId);
    if (target.role === "owner" || (actor.role !== "owner" && target.role === "admin"))
      throw new ConvexError("Owner permission required; demote owners before removing them.");
    await ctx.db.delete(membershipId);
  },
});
