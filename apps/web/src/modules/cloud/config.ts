export function cloudConfig(
  env: { url?: string; clientId?: string; apiHostname?: string; devMode?: string },
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
    url: url.href,
    clientId: env.clientId,
    apiHostname: env.apiHostname,
    devMode: local && env.devMode === "true",
    redirectUri: `${origin}/`,
  };
}
