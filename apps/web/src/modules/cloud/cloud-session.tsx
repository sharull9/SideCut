import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { useRouter } from "@tanstack/react-router";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import type { browserCloudConfig } from "./config";
import { CloudContext, type CloudState } from "./cloud-context";
import {
  readActiveTeamId,
  returnToFromState,
  safeReturnTo,
  writeActiveTeamId,
} from "./cloud-helpers";
import { markCloudUsed } from "./cloud-activation";

type Configuration = NonNullable<ReturnType<typeof browserCloudConfig>>;

// Loaded only when cloud is active on this page (see cloud-provider.tsx). Keeping AuthKit and
// Convex in this module keeps them out of the main bundle for users who never use cloud.
export default function CloudSession({
  configuration,
  children,
}: {
  configuration: Configuration;
  children: ReactNode;
}) {
  // Created once and never closed here: StrictMode and remounts would otherwise close a live client.
  const client = useMemo(
    () => new ConvexReactClient(configuration.url, { unsavedChangesWarning: false }),
    [configuration],
  );
  const [activeTeamId, setActive] = useState<string | null>(() => readActiveTeamId());
  const setActiveTeamId = useCallback((id: string | null) => {
    setActive(id);
    writeActiveTeamId(id);
  }, []);
  useEffect(() => {
    markCloudUsed();
  }, []);
  const value = useMemo<CloudState>(
    () => ({
      configured: true,
      available: true,
      activeTeamId,
      setActiveTeamId,
      // Already active: nothing to start.
      activate() {},
    }),
    [activeTeamId, setActiveTeamId],
  );
  const router = useRouter();
  const onRedirectCallback = useCallback(
    ({ state }: { state?: unknown }) => {
      // The dedicated /callback page has nothing to show, so fall back to the cloud team screen.
      const target =
        safeReturnTo(returnToFromState(state)) ??
        (window.location.pathname === "/callback" ? "/cloud?section=team" : null);
      if (!target) {
        // No usable return path: drop the one-time OAuth params and stay on this page.
        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        return;
      }
      // AuthKit removes code/state from the URL after this callback returns. Navigate after that
      // so the router, not AuthKit's replaceState, has the final say on the URL.
      window.setTimeout(() => {
        router
          .navigate({ href: target, replace: true })
          .catch(() => window.location.replace(target));
      }, 0);
    },
    [router],
  );
  return (
    <AuthKitProvider
      clientId={configuration.clientId}
      redirectUri={configuration.redirectUri}
      devMode={configuration.devMode}
      onRedirectCallback={onRedirectCallback}
      {...(configuration.apiHostname ? { apiHostname: configuration.apiHostname } : {})}
    >
      <ConvexProviderWithAuth client={client} useAuth={useWorkOSAuth}>
        <CloudContext.Provider value={value}>{children}</CloudContext.Provider>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

export function useWorkOSAuth() {
  const { isLoading, user, getAccessToken } = useAuth();
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        return await getAccessToken({ forceRefresh: forceRefreshToken });
      } catch {
        return null;
      }
    },
    [getAccessToken],
  );
  return { isLoading, isAuthenticated: !!user, fetchAccessToken };
}
