import { derivedCache } from "./derived-cache";
import { authorizeProviderURL, readProviderResponse } from "@sidecut/assets/transport";
import type { ProviderEnvironment, ProviderResponse } from "@sidecut/assets";
export function browserProviderEnvironment(): ProviderEnvironment {
  return {
    mode: "browser",
    hasCredential: async () => false,
    cacheGet: async (key) => derivedCache(key),
    cachePut: async (key, value) => {
      await derivedCache(key, value);
    },
    async request(r): Promise<ProviderResponse> {
      if (r.auth) throw new Error("Provider credentials require desktop transport.");
      authorizeProviderURL(r.provider, r.url);
      const response = await fetch(r.url, {
        signal: r.signal,
        redirect: "error",
        credentials: "omit",
      });
      return readProviderResponse(response);
    },
  };
}
