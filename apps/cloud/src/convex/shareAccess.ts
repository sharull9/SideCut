/// <reference types="node" />
"use node";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { tokenHash } from "./shares";

export const create = action({
  args: {
    versionId: v.id("mediaVersions"),
    private: v.boolean(),
    comments: v.boolean(),
    downloads: v.boolean(),
    expiresAt: v.number(),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ grantId: string; token: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Sign in required.");
    if (args.password !== undefined && (args.password.length < 8 || args.password.length > 256))
      throw new ConvexError("Password must contain 8–256 characters.");
    const token = randomBytes(32).toString("hex");
    const salt = args.password === undefined ? undefined : randomBytes(16).toString("hex");
    const grantId = await ctx.runMutation(internal.shares.create, {
      versionId: args.versionId,
      private: args.private,
      comments: args.comments,
      downloads: args.downloads,
      expiresAt: args.expiresAt,
      tokenHash: await tokenHash(token),
      ...(salt && args.password
        ? { passwordSalt: salt, passwordHash: scryptSync(args.password, salt, 32).toString("hex") }
        : {}),
    });
    return { grantId, token };
  },
});

export const open = action({
  args: { token: v.string(), password: v.optional(v.string()), name: v.string() },
  handler: async (ctx, args): Promise<{ sessionToken: string }> => {
    if ((args.password?.length ?? 0) > 256) throw new ConvexError("Share unavailable.");
    const grant = await ctx.runMutation(internal.shares.reserveOpen, {
      tokenHash: await tokenHash(args.token),
    });
    if (grant.passwordSalt && grant.passwordHash) {
      const actual = scryptSync(args.password ?? "", grant.passwordSalt, 32);
      const expected = Buffer.from(grant.passwordHash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new ConvexError("Share unavailable.");
    }
    const sessionToken = randomBytes(32).toString("hex");
    await ctx.runMutation(internal.shares.openSession, {
      grantId: grant._id,
      tokenHash: await tokenHash(sessionToken),
      name: args.name,
    });
    return { sessionToken };
  },
});
