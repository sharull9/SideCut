import { page, providerInfo, type Provider, type ProviderEnvironment } from "./provider.ts";
export function localProvider(env: ProviderEnvironment, id: "shared" | "import"): Provider {
  return {
    info: providerInfo(
      id,
      id === "shared" ? "Shared library" : "Import folders",
      ["music", "sfx", "sticker", "overlay", "video", "image", "font", "icon", "logo", "lut"],
      { cacheTTL: 0 },
    ),
    async search(q, signal) {
      signal.throwIfAborted();
      const assets = (await env.localAssets?.(id)) ?? [];
      signal.throwIfAborted();
      return page(assets, q);
    },
    async fetch(asset, signal) {
      signal.throwIfAborted();
      const files = await env.localFiles?.(asset);
      signal.throwIfAborted();
      if (!files?.length)
        throw new Error("Local provider file is missing. Choose its folder again.");
      return { asset, files };
    },
  };
}
