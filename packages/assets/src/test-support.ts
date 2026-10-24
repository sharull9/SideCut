import type { ProviderEnvironment } from "./provider.ts";
export function mockEnvironment(response: unknown = [], mode: "browser" | "host" = "host") {
  const requests: { url: string; body?: string; auth?: boolean }[] = [];
  const env: ProviderEnvironment = {
    mode,
    hasCredential: async () => true,
    request: async (r) => {
      requests.push(r);
      return {
        status: 200,
        headers: {},
        bytes: new TextEncoder().encode(JSON.stringify(response)).buffer,
      };
    },
  };
  return { env, requests };
}
