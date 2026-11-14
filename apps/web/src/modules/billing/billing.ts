import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { browserCloudConfig } from "../cloud/config";
import { billingEnabledAtBuild } from "./billing-flag";

// Re-exported so existing imports and tests keep working. The flag logic lives in billing-flag.ts.
export { parseBillingFlag, billingEnabledAtBuild } from "./billing-flag";

export type Subscription = {
  billingEnabled: boolean;
  active: boolean;
  loading: boolean;
};

// Declared locally: the shared @sidecut/cloud api object does not list billing yet.
const billingMode = makeFunctionReference<
  "query",
  Record<string, never>,
  { billingEnabled: boolean }
>("billing:mode");
const billingSubscription = makeFunctionReference<
  "query",
  { teamId: string },
  { billingEnabled: boolean; active: boolean; expiresAt: number | null }
>("billing:subscription");
const billingAccess = makeFunctionReference<
  "query",
  Record<string, never>,
  { billingEnabled: boolean; active: boolean }
>("billing:access");

function billingActive(): boolean {
  return billingEnabledAtBuild() && browserCloudConfig() !== null;
}

function selfHosted(): Subscription {
  return { billingEnabled: false, active: true, loading: false };
}

// Must render under the root CloudProvider (cloud-provider.tsx) when billing is active.
export function useSubscription(teamId?: string): Subscription {
  // Checked before any Convex hook so self-hosted builds never touch the network or need a provider.
  // The condition is fixed for the page load, so the hook order never changes between renders.
  if (!billingActive()) return selfHosted();
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- billingActive() is fixed for the page load, so the call order is stable.
  return useHostedSubscription(teamId);
}

function useHostedSubscription(teamId?: string): Subscription {
  const mode = useQuery(billingMode, {});
  const subscription = useQuery(
    billingSubscription,
    mode?.billingEnabled && teamId ? { teamId } : "skip",
  );
  // Without a selected workspace (e.g. the live studio), any subscribed workspace grants access.
  const anyWorkspace = useQuery(billingAccess, mode?.billingEnabled && !teamId ? {} : "skip");
  if (mode === undefined) return { billingEnabled: true, active: false, loading: true };
  if (!mode.billingEnabled) return selfHosted();
  if (!teamId) {
    if (anyWorkspace === undefined) return { billingEnabled: true, active: false, loading: true };
    return { billingEnabled: true, active: anyWorkspace.active, loading: false };
  }
  if (subscription === undefined) return { billingEnabled: true, active: false, loading: true };
  return { billingEnabled: true, active: subscription.active, loading: false };
}

export { billingActive };
