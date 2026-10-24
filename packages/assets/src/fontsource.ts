import { decodeAsset } from "@sidecut/contracts/assets";
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
export function fontsourceProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo("fontsource", "Google Fonts (Fontsource)", ["font"], {
      cacheTTL: 7 * 86400,
      notes: ["Open font licences. Each font keeps a licence snapshot and source link."],
    }),
    http = new ProviderHTTP(env, info);
  return {
    info,
    async search(q, signal) {
      if (!wants(q, "font")) return [];
      const rows = array(await http.json("https://api.fontsource.org/v1/fonts", signal)).map(
        (raw) => {
          const h = object(raw),
            id = str(h.id),
            spdx = str(h.license, "OFL-1.1");
          if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid Fontsource family ID.");
          return decodeAsset({
            provider: "fontsource",
            providerID: id,
            kind: "font",
            name: str(h.family, id),
            tags: [...list(h.category), ...list(h.subsets), ...(h.variable ? ["variable"] : [])],
            licenceClass: /^CC-BY-/i.test(spdx) ? "creditNeeded" : "noCredit",
            licenceName: spdx,
            pageURL: `https://fontsource.org/fonts/${id}`,
            remote: {
              spdx,
              weights: Array.isArray(h.weights) ? h.weights.join(",") : "",
              styles: list(h.styles).join(","),
            },
          });
        },
      );
      return page(rows, q);
    },
    async fetch(asset, signal) {
      if (!/^[a-z0-9-]+$/.test(asset.providerID)) throw new Error("Invalid Fontsource family ID.");
      const detail = object(
          await http.json(`https://api.fontsource.org/v1/fonts/${asset.providerID}`, signal),
        ),
        variants = object(detail.variants),
        candidates: { weight: number; style: string; url: string }[] = [];
      for (const [weight, styles] of Object.entries(variants))
        for (const [style, subsets] of Object.entries(object(styles))) {
          const subset = object(subsets),
            latin = object(subset.latin ?? Object.values(subset)[0]),
            links = object(latin.url),
            link = str(links.ttf ?? links.woff2);
          if (link) candidates.push({ weight: Number(weight) || 400, style, url: link });
        }
      candidates.sort(
        (a, b) =>
          (a.style === "normal" ? 0 : 1) - (b.style === "normal" ? 0 : 1) ||
          Math.abs(a.weight - 400) - Math.abs(b.weight - 400) ||
          a.weight - b.weight,
      );
      if (!candidates.length || candidates.length > 36)
        throw new Error("Fontsource returned no usable files or too many variants.");
      const files = [];
      for (const file of candidates) {
        signal.throwIfAborted();
        files.push(
          await http.file(
            file.url,
            `${asset.providerID}-${file.weight}-${file.style}.${new URL(file.url).pathname.endsWith(".ttf") ? "ttf" : "woff2"}`,
            signal,
          ),
        );
      }
      return { asset, files };
    },
  };
}
