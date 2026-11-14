import { env as browserEnv } from "../../env";

export function cloudConfig(
  env: {
    url?: string | undefined;
    clientId?: string | undefined;
    apiHostname?: string | undefined;
    devMode?: string | undefined;
    redirectUri?: string | undefined;
  },
  origin: string,
) {
  if (!env.url || !env.clientId || !origin.startsWith("http")) return null;
  const url = new URL(env.url);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  )
    return null;
  const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
  if (!local && !env.apiHostname) return null;
  return {
    // Not href: its trailing slash makes Convex connect to //api/…, which never opens.
    url: url.origin,
    clientId: env.clientId,
    apiHostname: env.apiHostname,
    devMode: local && env.devMode === "true",
    // The registered WorkOS Redirect URI wins; it must route to a page that mounts AuthKitProvider.
    redirectUri: env.redirectUri || `${origin}/team`,
  };
}

export function browserCloudConfig() {
  try {
    return cloudConfig(
      {
        url: browserEnv.VITE_CONVEX_URL,
        clientId: browserEnv.VITE_WORKOS_CLIENT_ID,
        apiHostname: browserEnv.VITE_WORKOS_API_HOSTNAME,
        devMode: browserEnv.VITE_WORKOS_DEV_MODE,
        redirectUri: browserEnv.VITE_WORKOS_REDIRECT_URI,
      },
      window.location.origin,
    );
  } catch {
    return null;
  }
}
