import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import {
  ProviderHTTP,
  providerInfo,
  object,
  array,
  str,
  list,
  num,
  page,
  wants,
  title,
  type Provider,
  type ProviderEnvironment,
} from "./provider.ts";
export const NOTO_CREDIT =
  "Animated Noto Emoji by Google, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)";
export function notoAsset(
  codepoint: string,
  tags: string[] = [],
  categories: string[] = [],
  popularity?: number,
): Asset {
  if (!/^[0-9a-f]+(?:_[0-9a-f]+)*$/i.test(codepoint)) throw new Error("Invalid Noto codepoint.");
  const clean = tags.map((t) => t.replace(/^:|:$/g, "").replaceAll("-", " ")),
    root = `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/`;
  return decodeAsset({
    provider: "noto",
    providerID: codepoint,
    kind: "sticker",
    name: title(clean[0] ?? codepoint),
    tags: [...clean, ...categories],
    hasAlpha: true,
    width: 1024,
    height: 1024,
    licenceClass: "creditNeeded",
    licenceName: "CC BY 4.0",
    creditLine: NOTO_CREDIT,
    pageURL: "https://googlefonts.github.io/noto-emoji-animation/",
    previewURL: `${root}512.webp`,
    thumbnailURL: `${root}emoji.svg`,
    popularity,
    remote: { lottie: `${root}lottie.json`, webp: `${root}512.webp`, gif: `${root}512.gif` },
  });
}
export function notoProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo("noto", "Noto animated emoji", ["sticker"], {
      cacheTTL: 7 * 86400,
      notes: [NOTO_CREDIT],
    }),
    http = new ProviderHTTP(env, info);
  return {
    info,
    async search(q, signal) {
      if (!wants(q, "sticker")) return [];
      const data = object(
        await http.json("https://googlefonts.github.io/noto-emoji-animation/data/api.json", signal),
      );
      const rows = array(data.icons).map((raw) => {
        const h = object(raw);
        return notoAsset(str(h.codepoint), list(h.tags), list(h.categories), num(h.popularity));
      });
      return page(
        rows.sort(
          (a, b) =>
            Number((b as Record<string, unknown>).popularity ?? 0) -
            Number((a as Record<string, unknown>).popularity ?? 0),
        ),
        q,
      );
    },
    async fetch(asset, signal) {
      const a = notoAsset(asset.providerID),
        webp = await http.file(asset.remote.webp ?? a.remote.webp!, "original-512.webp", signal);
      try {
        const lottie = await http.file(
          asset.remote.lottie ?? a.remote.lottie!,
          "original.json",
          signal,
        );
        return { asset, files: [lottie, webp] };
      } catch {
        signal.throwIfAborted();
        return { asset, files: [webp] };
      }
    },
  };
}
