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
export const publishPayload = v.object({
  title: v.string(),
  description: v.string(),
  words: v.array(v.object({ text: v.string(), start: v.number(), end: v.number() })),
  chapters: v.array(v.object({ title: v.string(), start: v.number() })),
});
export const publishArtifact = v.object({ name: v.string(), type: v.string(), text: v.string() });

export default defineSchema({
  serviceAccounts: defineTable({
    teamId: v.id("teams"),
    enabled: v.boolean(),
    limit: v.number(),
    used: v.number(),
    reserved: v.number(),
    expiresAt: v.number(),
    sequence: v.number(),
  }).index("by_team", ["teamId"]),
  billingEvents: defineTable({
    eventId: v.string(),
    teamId: v.id("teams"),
    sequence: v.number(),
    enabled: v.boolean(),
    limit: v.number(),
    expiresAt: v.number(),
  }).index("by_event", ["eventId"]),
  usageReservations: defineTable({
    jobId: v.id("publishJobs"),
    teamId: v.id("teams"),
    total: v.number(),
    consumed: v.number(),
    remaining: v.number(),
  }).index("by_job", ["jobId"]),
  aiConsents: defineTable({
    teamId: v.id("teams"),
    user: v.string(),
    enabled: v.boolean(),
    generation: v.number(),
  }).index("by_team_user", ["teamId", "user"]),
  publishJobs: defineTable({
    teamId: v.id("teams"),
    versionId: v.id("mediaVersions"),
    user: v.string(),
    requestId: v.string(),
    consentGeneration: v.number(),
    payload: publishPayload,
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attempt: v.number(),
    leaseUntil: v.number(),
    checkpoint: v.number(),
    artifacts: v.array(publishArtifact),
    deletedAt: v.optional(v.number()),
  })
    .index("by_user_request", ["user", "requestId"])
    .index("by_status", ["status", "deletedAt"])
    .index("by_team_user_request", ["teamId", "user", "requestId"]),
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
    createRequestId: v.optional(v.string()),
  })
    .index("by_team", ["teamId"])
    .index("by_team_request", ["teamId", "createRequestId"])
    .index("by_team_archived", ["teamId", "archived"])
    .index("by_team_archived_name", ["teamId", "archived", "name"])
    .index("by_team_folder_archived", ["teamId", "folderId", "archived"])
    .index("by_team_folder_archived_name", ["teamId", "folderId", "archived", "name"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["teamId", "folderId", "archived"],
    }),
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
      v.literal("cancelled"),
    ),
    attempt: v.number(),
    objectKey: v.string(),
    // Recording uploads start before their size is known; `seal` fixes the size and part count.
    open: v.optional(v.boolean()),
    // Moments marked while recording, in seconds from the start of the take.
    marks: v.optional(v.array(v.object({ seconds: v.number(), name: v.string() }))),
    uploadId: v.optional(v.string()),
    error: v.optional(v.string()),
    playbackKey: v.optional(v.string()),
    thumbnailKey: v.optional(v.string()),
    workflow: v.optional(reviewWorkflow),
    workflowRevision: v.optional(v.number()),
    fileName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  })
    .index("by_media", ["mediaId"])
    .index("by_request", ["mediaId", "requestId"])
    .index("by_status", ["status"]),
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
