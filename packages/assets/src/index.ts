export * from "./provider.ts";
export { notoAsset } from "./noto.ts";
import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import { decodeProviderQuery, decodeGeneration } from "@sidecut/contracts/providers";
import {
  ProviderHTTP,
  ProviderError,
  type ProviderEnvironment,
  type Provider,
  type FetchedAsset,
} from "./provider.ts";
import { localProvider } from "./local.ts";
import { pixabayProvider } from "./pixabay.ts";
import { pexelsProvider } from "./pexels.ts";
import { freesoundProvider } from "./freesound.ts";
import { iconifyProvider } from "./iconify.ts";
import { svglProvider } from "./svgl.ts";
import { notoProvider } from "./noto.ts";
import { fontsourceProvider } from "./fontsource.ts";
import { elevenlabsProvider } from "./elevenlabs.ts";
import { epidemicProvider, lordiconProvider } from "./stubs.ts";
export class AssetProviders {
  private readonly providers: Map<string, Provider>;
  constructor(private readonly env: ProviderEnvironment) {
    this.providers = new Map(
      [
        localProvider(env, "shared"),
        localProvider(env, "import"),
        pixabayProvider(env),
        pexelsProvider(env),
        freesoundProvider(env),
        iconifyProvider(env),
        svglProvider(env),
        notoProvider(env),
        fontsourceProvider(env),
        elevenlabsProvider(env),
        epidemicProvider(),
        lordiconProvider(),
      ].map((p) => [p.info.id, p]),
    );
  }
  private provider(id: string) {
    const p = this.providers.get(id);
    if (!p) throw new ProviderError("invalid", id, "Unknown asset provider.");
    return p;
  }
  async list() {
    return Promise.all(
      [...this.providers.values()].map(async (p) => ({
        ...p.info,
        status: p.status ? await p.status() : await new ProviderHTTP(this.env, p.info).status(),
      })),
    );
  }
  async search(id: string, value: unknown, signal: AbortSignal) {
    const q = decodeProviderQuery(value),
      p = this.provider(id);
    signal.throwIfAborted();
    return p.search(q, signal);
  }
  async fetch(value: unknown, signal: AbortSignal) {
    const asset = decodeAsset(value),
      p = this.provider(asset.provider);
    signal.throwIfAborted();
    return p.fetch(asset, signal);
  }
  async similar(value: unknown, limit: number, signal: AbortSignal) {
    const asset = decodeAsset(value),
      p = this.provider(asset.provider);
    if (!Number.isInteger(limit) || limit < 1 || limit > 150 || !p.similar)
      throw new ProviderError(
        "unsupported",
        asset.provider,
        "Similar assets are unavailable for this request.",
      );
    return p.similar(asset, limit, signal);
  }
  async generate(
    id: string,
    value: unknown,
    confirmedPaid: boolean,
    signal: AbortSignal,
    save: (take: FetchedAsset) => Promise<void>,
  ) {
    const r = decodeGeneration(value),
      p = this.provider(id);
    if (confirmedPaid !== true)
      throw new ProviderError(
        "invalid",
        id,
        "Confirm the paid request and variation count before generating.",
      );
    if (!p.generate)
      throw new ProviderError("unsupported", id, "This provider cannot generate assets.");
    return p.generate(r, signal, save);
  }
}
export function assetLicence(asset: Asset) {
  const urls: Record<string, string> = {
    noto: "https://creativecommons.org/licenses/by/4.0/",
    pixabay: "https://pixabay.com/service/license-summary/",
    pexels: "https://www.pexels.com/license/",
    elevenlabs: "https://elevenlabs.io/terms-of-use",
  };
  return {
    name: asset.licenceName ?? asset.remote.licenceTitle ?? asset.remote.spdx ?? "Unknown licence",
    licenceClass: asset.licenceClass,
    spdx: asset.remote.spdx ?? null,
    url:
      asset.remote.licenceURL ??
      urls[asset.provider] ??
      (asset.provider === "fontsource" ? "https://openfontlicense.org" : null),
    holder: asset.remote.creator ?? asset.remote.author ?? null,
    creditLine: asset.creditLine ?? null,
    sourceURL: asset.pageURL ?? null,
    snapshottedAt: new Date().toISOString(),
  };
}
