import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import {
  ProviderHTTP,
  providerInfo,
  object,
  array,
  str,
  list,
  wants,
  url,
  title,
  type Provider,
  type ProviderEnvironment,
} from "./provider.ts";
export function iconifyProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo("iconify", "Iconify", ["icon"], {
      notes: [
        "Each set has its own licence. GPL, share-alike and noncommercial sets are excluded.",
      ],
    }),
    http = new ProviderHTTP(env, info);
  return {
    info,
    async search(q, signal) {
      if (!wants(q, "icon") || !q.text.trim()) return [];
      const limit = Math.min(999, Math.max(32, q.perPage)),
        data = object(
          await http.json(
            url("https://api.iconify.design/search", {
              query: q.text,
              limit,
              start: (q.page - 1) * limit,
            }),
            signal,
          ),
        ),
        sets = object(data.collections ?? {}),
        rows: Asset[] = [];
      for (const value of array(data.icons)) {
        const id = str(value),
          parts = id.split(":");
        if (parts.length !== 2 || !parts.every((p) => /^[a-z0-9-]+$/i.test(p))) continue;
        const raw = sets[parts[0]!];
        if (!raw) continue;
        const set = object(raw),
          licence = object(set.license ?? {}),
          spdx = str(licence.spdx);
        if (!spdx || /GPL|(?:^|-)NC(?:-|$)|BY-SA|BY-ND/i.test(spdx)) continue;
        const author = object(set.author ?? {}),
          creator = str(author.name, str(set.name)),
          licenceClass = /^CC-BY-/i.test(spdx)
            ? "creditNeeded"
            : /MIT|Apache|OFL|CC0|ISC|BSD|Unlicense/i.test(spdx)
              ? "noCredit"
              : "unknown",
          licenceName = str(licence.title, spdx),
          svg = url(`https://api.iconify.design/${parts[0]}/${parts[1]}.svg`, { color: "#FFFFFF" });
        rows.push(
          decodeAsset({
            provider: "iconify",
            providerID: id,
            kind: "icon",
            name: title(parts[1]!),
            tags: [str(set.name), ...list(set.category), ...list(set.tags)],
            summary: `${str(set.name)} by ${creator}, ${licenceName}`,
            hasAlpha: true,
            licenceClass,
            licenceName,
            creditLine:
              licenceClass === "creditNeeded"
                ? `${str(set.name)} icons by ${creator}, ${licenceName}`
                : undefined,
            pageURL: `https://icon-sets.iconify.design/${parts[0]}/${parts[1]}/`,
            previewURL: svg,
            thumbnailURL: svg,
            remote: {
              svg,
              set: parts[0]!,
              setName: str(set.name),
              author: creator,
              spdx,
              licenceTitle: licenceName,
              ...(str(licence.url) ? { licenceURL: str(licence.url) } : {}),
            },
          }),
        );
      }
      return rows;
    },
    async fetch(asset, signal) {
      if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(asset.providerID))
        throw new Error("Invalid Iconify ID.");
      const link =
        asset.remote.svg ??
        url(`https://api.iconify.design/${asset.providerID.replace(":", "/")}.svg`, {
          color: "#FFFFFF",
        });
      return { asset, files: [await http.file(link, "original.svg", signal)] };
    },
  };
}
