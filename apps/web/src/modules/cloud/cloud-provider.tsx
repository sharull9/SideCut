import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { useRouter } from "@tanstack/react-router";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import { browserCloudConfig } from "./config";

export const activeTeamStorageKey = "sidecut.cloud.activeTeam";

const placeholderOrigin = "https://sidecut.invalid";

// `state` round-trips through the OAuth redirect in the URL, so it is untrusted input.
// Accept only same-origin relative paths: "/x" yes, "//host" and "/\host" no, control characters no.
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === "\\") return null;
  }
  try {
    if (new URL(value, placeholderOrigin).origin !== placeholderOrigin) return null;
  } catch {
    return null;
  }
  return value;
}

// The current page as a relative path, without the one-time OAuth `code` and `state` params.
export function currentReturnTo(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete("code");
  params.delete("state");
  const search = params.toString();
  return `${window.location.pathname}${search ? `?${search}` : ""}`;
}

function returnToFromState(state: unknown): unknown {
  return typeof state === "object" && state !== null
    ? (state as { returnTo?: unknown }).returnTo
    : undefined;
}

type TeamStorageReader = Pick<Storage, "getItem">;
type TeamStorageWriter = Pick<Storage, "setItem" | "removeItem">;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readActiveTeamId(
  storage: TeamStorageReader | null = browserStorage(),
): string | null {
  try {
    return storage?.getItem(activeTeamStorageKey) || null;
  } catch {
    return null;
  }
}

export function writeActiveTeamId(
  teamId: string | null,
  storage: TeamStorageWriter | null = browserStorage(),
): void {
  try {
    if (teamId) storage?.setItem(activeTeamStorageKey, teamId);
    else storage?.removeItem(activeTeamStorageKey);
  } catch {
    // Storage can be blocked (private mode, quota). The selection still holds for this page load.
  }
}

export type CloudState = {
  configured: boolean;
  activeTeamId: string | null;
  setActiveTeamId(id: string | null): void;
};

const unconfigured: CloudState = {
  configured: false,
  activeTeamId: null,
  setActiveTeamId() {},
};

const CloudContext = createContext<CloudState>(unconfigured);

// Components that call Convex hooks must only render when `configured` is true.
export function useCloud(): CloudState {
  return useContext(CloudContext);
}

type Configuration = NonNullable<ReturnType<typeof browserCloudConfig>>;

// One app-wide cloud connection: AuthKit sign-in plus a single Convex client.
// Mount once at the root. When cloud is not configured, children render with
// `configured: false` and no network calls are made.
export function CloudProvider({ children }: { children: ReactNode }) {
  const [configuration] = useState(browserCloudConfig);
  if (!configuration) {
    return <CloudContext.Provider value={unconfigured}>{children}</CloudContext.Provider>;
  }
  return <ConfiguredCloud configuration={configuration}>{children}</ConfiguredCloud>;
}

function ConfiguredCloud({
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
  const value = useMemo<CloudState>(
    () => ({ configured: true, activeTeamId, setActiveTeamId }),
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
