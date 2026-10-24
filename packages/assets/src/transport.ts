import { ProviderError, type ProviderRequest } from "./provider.ts";
const domains: Record<string, string[]> = {
  pixabay: ["pixabay.com", "cdn.pixabay.com"],
  pexels: ["api.pexels.com", "images.pexels.com", "videos.pexels.com"],
  freesound: ["freesound.org", "cdn.freesound.org"],
  iconify: ["api.iconify.design"],
  svgl: ["api.svgl.app", "svgl.app", "raw.githubusercontent.com"],
  noto: ["googlefonts.github.io", "fonts.gstatic.com"],
  fontsource: [
    "api.fontsource.org",
    "cdn.jsdelivr.net",
    "fonts.gstatic.com",
    "raw.githubusercontent.com",
  ],
  elevenlabs: ["api.elevenlabs.io"],
};
export function authorizeProviderURL(provider: string, value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !domains[provider]?.includes(u.hostname)
  )
    throw new ProviderError(
      "invalid",
      provider,
      "Provider resource URL is outside its allowed HTTPS domains.",
    );
  return u;
}
export function authenticatedRequest(request: ProviderRequest, secret?: string) {
  const u = authorizeProviderURL(request.provider, request.url),
    headers: Record<string, string> = {};
  if (request.body) headers["Content-Type"] = "application/json";
  if (request.auth) {
    if (!secret)
      throw new ProviderError(
        "needsKey",
        request.provider,
        "Provider credentials are not configured.",
      );
    const allowed: Record<string, string[]> = {
      pixabay: ["pixabay.com"],
      pexels: ["api.pexels.com"],
      freesound: ["freesound.org"],
      elevenlabs: ["api.elevenlabs.io"],
    };
    if (!allowed[request.provider]?.includes(u.hostname))
      throw new ProviderError(
        "invalid",
        request.provider,
        "Credentials cannot be sent to this download host.",
      );
    if (request.provider === "pixabay") u.searchParams.set("key", secret);
    else if (request.provider === "pexels") headers.Authorization = secret;
    else if (request.provider === "freesound") headers.Authorization = `Token ${secret}`;
    else headers["xi-api-key"] = secret;
  }
  return { url: u.href, headers };
}
export async function readProviderResponse(
  response: Pick<Response, "status" | "headers" | "body">,
) {
  const limit = 64 * 1024 * 1024;
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    throw new Error("Provider file exceeds 64 MiB.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error("Provider file exceeds 64 MiB.");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    bytes: bytes.buffer,
  };
}
