import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const role = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);
export const invitedRole = v.union(v.literal("admin"), v.literal("member"), v.literal("viewer"));
export const reviewWorkflow = v.union(v.literal("review"), v.literal("rework"), v.literal("done"));

export default defineSchema({
  shareGrants: defineTable({
    versionId: v.id("mediaVersions"),
    tokenHash: v.string(),
    createdBy: v.string(),
    private: v.boolean(),
    comments: v.boolean(),
    downloads: v.boolean(),
    expiresAt: v.number(),
    revoked: v.boolean(),
    passwordSalt: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    openWindow: v.number(),
    openAttempts: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_version", ["versionId"]),
  guestSessions: defineTable({
    grantId: v.id("shareGrants"),
    tokenHash: v.string(),
    name: v.string(),
    user: v.optional(v.string()),
    expiresAt: v.number(),
    lastSeen: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_grant", ["grantId"]),
  guestComments: defineTable({
    grantId: v.id("shareGrants"),
    versionId: v.id("mediaVersions"),
    sessionId: v.id("guestSessions"),
    requestId: v.string(),
    body: v.string(),
    at: v.number(),
    end: v.optional(v.number()),
    parentId: v.optional(v.id("guestComments")),
    resolved: v.boolean(),
  })
    .index("by_grant", ["grantId"])
    .index("by_request", ["sessionId", "requestId"]),
  folders: defineTable({ teamId: v.id("teams"), name: v.string() }).index("by_team", ["teamId"]),
  media: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    folderId: v.optional(v.id("folders")),
    archived: v.boolean(),
    nextVersion: v.number(),
    readyVersionId: v.optional(v.id("mediaVersions")),
  }).index("by_team", ["teamId"]),
  mediaVersions: defineTable({
    mediaId: v.id("media"),
    number: v.number(),
    requestId: v.string(),
    snapshot: v.string(),
    expectedBytes: v.number(),
    partCount: v.number(),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    attempt: v.number(),
    objectKey: v.string(),
    uploadId: v.optional(v.string()),
    error: v.optional(v.string()),
    playbackKey: v.optional(v.string()),
    thumbnailKey: v.optional(v.string()),
    workflow: v.optional(reviewWorkflow),
    workflowRevision: v.optional(v.number()),
  })
    .index("by_media", ["mediaId"])
    .index("by_request", ["mediaId", "requestId"]),
  uploadParts: defineTable({
    versionId: v.id("mediaVersions"),
    part: v.number(),
    etag: v.string(),
    bytes: v.number(),
  }).index("by_version_part", ["versionId", "part"]),
  teams: defineTable({ name: v.string() }),
  memberships: defineTable({ teamId: v.id("teams"), user: v.string(), role })
    .index("by_user", ["user"])
    .index("by_team_user", ["teamId", "user"]),
  invitations: defineTable({
    teamId: v.id("teams"),
    email: v.string(),
    role: invitedRole,
    createdBy: v.string(),
    expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
  })
    .index("by_team", ["teamId"])
    .index("by_email", ["email"]),
});
