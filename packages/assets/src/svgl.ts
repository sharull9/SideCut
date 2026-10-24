import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import {
  ProviderHTTP,
  providerInfo,
  object,
  array,
  str,
  list,
  page,
  wants,
  type Provider,
  type ProviderEnvironment,
} from "./provider.ts";
export function svglProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo("svgl", "SVGL logos", ["logo"], {
      notes: [
        "Brand logos are trademarks of their owners. Check brand guidelines and do not imply endorsement.",
      ],
    }),
    http = new ProviderHTTP(env, info);
  return {
    info,
    async search(q, signal) {
      if (!wants(q, "logo")) return [];
      const data = array(await http.json("https://api.svgl.app", signal)),
        seen = new Set<string>(),
        rows: Asset[] = [];
      for (const item of data) {
        const logo = object(item),
          brand = str(logo.title);
        if (!brand) throw new Error("SVGL logo needs a title.");
        const add = (link: unknown, variant: string | undefined, wordmark: boolean) => {
          if (!str(link)) return;
          const parsed = new URL(str(link)),
            id = decodeURIComponent(parsed.pathname.split("/").at(-1)!).replace(/\.svg$/i, "");
          if (seen.has(id)) return;
          seen.add(id);
          rows.push(
            decodeAsset({
              provider: "svgl",
              providerID: id,
              kind: "logo",
              name:
                brand +
                (wordmark ? " wordmark" : "") +
                (variant ? ` (for ${variant} backgrounds)` : ""),
              tags: [
                brand,
                "logo",
                ...list(logo.category),
                ...(wordmark ? ["wordmark"] : []),
                ...(variant ? [variant] : []),
              ],
              summary: `${brand} logo, a trademark of its owner`,
              hasAlpha: true,
              licenceClass: "noCredit",
              licenceName: `Trademark of ${brand}'s owner`,
              pageURL: logo.url,
              previewURL: parsed.href,
              thumbnailURL: parsed.href,
              remote: {
                svg: parsed.href,
                title: brand,
                ...(str(logo.brandUrl) ? { brandURL: str(logo.brandUrl) } : {}),
              },
            }),
          );
        };
        for (const wordmark of [false, true]) {
          const route = wordmark ? logo.wordmark : logo.route;
          if (typeof route === "string") add(route, undefined, wordmark);
          else if (route) {
            const variants = object(route);
            add(variants.light, "light", wordmark);
            add(variants.dark, "dark", wordmark);
          }
        }
      }
      return page(rows, q);
    },
    async fetch(asset, signal) {
      const link = asset.remote.svg;
      if (!link) throw new Error("SVGL resource URL is missing.");
      return { asset, files: [await http.file(link, "original.svg", signal)] };
    },
  };
}
