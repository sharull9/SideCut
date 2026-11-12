// Decides once, at first render, whether this page loads the cloud providers.
// Dependency-free: imported by the main bundle, so it must not pull in AuthKit or Convex.

import { browserStorage, type TeamStorageReader, type TeamStorageWriter } from "./cloud-helpers";

// The flag rule lives in billing-flag.ts, which has no dependencies.
export { billingEnabledAtBuild, parseBillingFlag } from "../billing/billing-flag";

export const cloudUsedStorageKey = "sidecut.cloud.used";

const cloudPathSegments = ["cloud", "login", "callback"];

// Matches "/cloud", "/cloud/x", "/login", "/callback". Does not match "/cloudy".
export function isCloudPath(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  return cloudPathSegments.includes(first);
}

// WorkOS redirects back with one-time `code` and `state` params.
export function hasOAuthCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") && params.has("state");
}

// Set when a cloud session mounts, so later visits to any page load cloud up front.
export function readCloudUsed(storage: TeamStorageReader | null = browserStorage()): boolean {
  try {
    return storage?.getItem(cloudUsedStorageKey) === "1";
  } catch {
    return false;
  }
}

export function markCloudUsed(
  storage: Pick<TeamStorageWriter, "setItem"> | null = browserStorage(),
): void {
  try {
    storage?.setItem(cloudUsedStorageKey, "1");
  } catch {
    // Blocked storage only means the next visit starts dormant. Cloud still works on this page.
  }
}

export type ActivationInput = {
  configured: boolean;
  pathname: string;
  search: string;
  rememberedSignIn: boolean;
  billingBuildFlag: boolean;
};

// Cloud loads only when the deployment is configured and one of these holds:
// the URL is a cloud page, the URL carries an OAuth callback, the user has used cloud before,
// or billing is enabled for this build.
export function shouldActivateCloud(input: ActivationInput): boolean {
  if (!input.configured) return false;
  return (
    isCloudPath(input.pathname) ||
    hasOAuthCallback(input.search) ||
    input.rememberedSignIn ||
    input.billingBuildFlag
  );
}
