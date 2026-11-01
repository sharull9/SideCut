/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as library from "../library.js";
import type * as model from "../model.js";
import type * as publishJobs from "../publishJobs.js";
import type * as publishPack from "../publishPack.js";
import type * as shareAccess from "../shareAccess.js";
import type * as shares from "../shares.js";
import type * as storage from "../storage.js";
import type * as teams from "../teams.js";
import type * as versions from "../versions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounts: typeof accounts;
  library: typeof library;
  model: typeof model;
  publishJobs: typeof publishJobs;
  publishPack: typeof publishPack;
  shareAccess: typeof shareAccess;
  shares: typeof shares;
  storage: typeof storage;
  teams: typeof teams;
  versions: typeof versions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
