import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { CloudContext, dormantCloud, type CloudState } from "./cloud-context";
import {
  billingEnabledAtBuild,
  markCloudUsed,
  readCloudUsed,
  shouldActivateCloud,
} from "./cloud-activation";
import { browserCloudConfig } from "./config";

// Dependency-free re-exports. Importing these never loads AuthKit or Convex.
export { useCloud, type CloudState } from "./cloud-context";
export {
  activeTeamStorageKey,
  currentReturnTo,
  readActiveTeamId,
  safeReturnTo,
  writeActiveTeamId,
} from "./cloud-helpers";

// AuthKit and Convex live in cloud-session.tsx and load only when cloud is active on this page.
const CloudSession = lazy(() => import("./cloud-session"));

type Configuration = NonNullable<ReturnType<typeof browserCloudConfig>>;

type Activation =
  | { mode: "dormant"; available: boolean }
  | { mode: "active"; configuration: Configuration };

// Decided once per page load. The result never changes, so the wrapper does not swap and the
// route tree does not remount.
function decideActivation(): Activation {
  const configuration = browserCloudConfig();
  if (!configuration) return { mode: "dormant", available: false };
  const active = shouldActivateCloud({
    configured: true,
    pathname: window.location.pathname,
    search: window.location.search,
    rememberedSignIn: readCloudUsed(),
    billingBuildFlag: billingEnabledAtBuild(),
  });
  return active ? { mode: "active", configuration } : { mode: "dormant", available: true };
}

// One app-wide cloud connection. Mount once at the root.
// When cloud is dormant, children render with `configured: false` and nothing cloud-related loads.
export function CloudProvider({ children }: { children: ReactNode }) {
  const [activation] = useState<Activation>(decideActivation);
  if (activation.mode === "dormant") {
    return <DormantCloud available={activation.available}>{children}</DormantCloud>;
  }
  return (
    <Suspense fallback={<CloudLoading />}>
      <CloudSession configuration={activation.configuration}>{children}</CloudSession>
    </Suspense>
  );
}

function DormantCloud({ available, children }: { available: boolean; children: ReactNode }) {
  const activate = useCallback(() => {
    if (!available) return;
    markCloudUsed();
    // replace, not assign: the page is already at its target URL, and a new history entry here
    // would make Back return to a dormant copy of the page that reloads again.
    window.location.replace(window.location.href);
  }, [available]);
  const value = useMemo<CloudState>(
    () => ({ ...dormantCloud, available, activate }),
    [available, activate],
  );
  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

function CloudLoading() {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center">
      Loading…
    </div>
  );
}
