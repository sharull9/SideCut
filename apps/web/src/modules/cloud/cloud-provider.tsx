import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { browserCloudConfig } from "./config";

const CloudContext = createContext({ configured: false });

/** Whether this build has cloud sign-in. Convex and AuthKit hooks may only run when it does. */
export function useCloud() {
  return useContext(CloudContext);
}

function useWorkOSAuth() {
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

/**
 * One signed-in cloud connection for every page, so Studio, Team and Edit share the same session.
 * It lives for the whole app, so the client is never closed.
 */
export function CloudProvider({ children }: { children: ReactNode }) {
  const [configuration] = useState(browserCloudConfig);
  const [client] = useState(() =>
    configuration
      ? new ConvexReactClient(configuration.url, { unsavedChangesWarning: false })
      : null,
  );
  if (!configuration || !client)
    return <CloudContext value={{ configured: false }}>{children}</CloudContext>;
  return (
    <AuthKitProvider
      clientId={configuration.clientId}
      redirectUri={configuration.redirectUri}
      devMode={configuration.devMode}
      {...(configuration.apiHostname ? { apiHostname: configuration.apiHostname } : {})}
    >
      <ConvexProviderWithAuth client={client} useAuth={useWorkOSAuth}>
        <CloudContext value={{ configured: true }}>{children}</CloudContext>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
