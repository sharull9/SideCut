import { ConvexError, v } from "convex/values";
import type { GenericId } from "convex/values";
import { query, type QueryCtx } from "./model";
import { membership } from "./access";

// Billing enforcement is hosted-only and off by default. Self-hosted deployments leave the flag unset.
export function billingEnabled() {
  const value = process.env.SIDECUT_BILLING_ENABLED;
  return value === "true" || value === "1";
}

export async function serviceAccount(ctx: QueryCtx, teamId: GenericId<"teams">) {
  return ctx.db
    .query("serviceAccounts")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .unique();
}

function isEntitled(row: { enabled: boolean; expiresAt: number } | null) {
  return !!row?.enabled && (row.expiresAt === 0 || row.expiresAt > Date.now());
}

export async function entitled(ctx: QueryCtx, teamId: GenericId<"teams">) {
  return isEntitled(await serviceAccount(ctx, teamId));
}

/** Server-side gate for paid operations. Call after identity and membership checks. */
export async function requireSubscription(ctx: QueryCtx, teamId: GenericId<"teams">) {
  if (!billingEnabled()) return;
  if (!(await entitled(ctx, teamId))) throw new ConvexError("Subscription required.");
}

export const mode = query({
  args: {},
  handler: () => ({ billingEnabled: billingEnabled() }),
});

export const subscription = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await membership(ctx, args.teamId);
    if (!billingEnabled()) return { billingEnabled: false, active: true, expiresAt: null };
    const row = await serviceAccount(ctx, args.teamId);
    return {
      billingEnabled: true,
      active: isEntitled(row),
      expiresAt: row && row.expiresAt !== 0 ? row.expiresAt : null,
    };
  },
});

/** Workspace-independent check for surfaces without a selected team, such as the live studio. */
export const access = query({
  args: {},
  handler: async (ctx) => {
    if (!billingEnabled()) return { billingEnabled: false, active: true };
    const user = await ctx.auth.getUserIdentity();
    if (!user) return { billingEnabled: true, active: false };
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("user", user.tokenIdentifier))
      .take(100);
    for (const member of memberships)
      if (await entitled(ctx, member.teamId)) return { billingEnabled: true, active: true };
    return { billingEnabled: true, active: false };
  },
});
