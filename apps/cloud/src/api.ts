import { makeFunctionReference } from "convex/server";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as teams from "./convex/teams";
import type * as library from "./convex/library";
import type * as versions from "./convex/versions";
import type * as storage from "./convex/storage";
import type * as shares from "./convex/shares";
import type * as shareAccess from "./convex/shareAccess";

// Typed public references also work before a hosted deployment generates bindings.
export const api: FilterApi<
  ApiFromModules<{
    teams: typeof teams;
    library: typeof library;
    versions: typeof versions;
    storage: typeof storage;
    shares: typeof shares;
    shareAccess: typeof shareAccess;
  }>,
  FunctionReference<"query" | "mutation" | "action", "public">
> = {
  shares: {
    list: makeFunctionReference("shares:list"),
    revoke: makeFunctionReference("shares:revoke"),
    view: makeFunctionReference("shares:view"),
    heartbeat: makeFunctionReference("shares:heartbeat"),
    comment: makeFunctionReference("shares:comment"),
    resolve: makeFunctionReference("shares:resolve"),
    workflow: makeFunctionReference("shares:workflow"),
  },
  shareAccess: {
    create: makeFunctionReference("shareAccess:create"),
    open: makeFunctionReference("shareAccess:open"),
  },
  library: {
    createFolder: makeFunctionReference("library:createFolder"),
    folders: makeFunctionReference("library:folders"),
    create: makeFunctionReference("library:create"),
    list: makeFunctionReference("library:list"),
    bulk: makeFunctionReference("library:bulk"),
  },
  versions: {
    begin: makeFunctionReference("versions:begin"),
    list: makeFunctionReference("versions:list"),
    retryProcessing: makeFunctionReference("versions:retryProcessing"),
  },
  storage: {
    start: makeFunctionReference("storage:start"),
    partUrl: makeFunctionReference("storage:partUrl"),
    complete: makeFunctionReference("storage:complete"),
    playbackUrl: makeFunctionReference("storage:playbackUrl"),
    guestUrl: makeFunctionReference("storage:guestUrl"),
  },
  teams: {
    list: makeFunctionReference("teams:list"),
    create: makeFunctionReference("teams:create"),
    members: makeFunctionReference("teams:members"),
    invite: makeFunctionReference("teams:invite"),
    pendingInvitations: makeFunctionReference("teams:pendingInvitations"),
    accept: makeFunctionReference("teams:accept"),
    revokeInvitation: makeFunctionReference("teams:revokeInvitation"),
    setRole: makeFunctionReference("teams:setRole"),
    removeMember: makeFunctionReference("teams:removeMember"),
    invitations: makeFunctionReference("teams:invitations"),
  },
};
