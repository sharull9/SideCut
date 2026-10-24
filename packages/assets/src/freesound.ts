import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import {
  ProviderHTTP,
  providerInfo,
  object,
  array,
  str,
  num,
  list,
  wants,
  url,
  type Provider,
  type ProviderEnvironment,
  type ProviderQuery,
} from "./provider.ts";
export function freesoundProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo(
      "freesound",
      "Freesound",
      ["sfx"],
      {
        notes: [
          "Disabled until the operator accepts commercial API use. Downloads are HQ MP3 previews, not original recordings.",
        ],
      },
      { similar: true },
    ),
    http = new ProviderHTTP(env, info);
  const map = (raw: unknown): Asset | null => {
    const h = object(raw),
      licence = str(h.license);
    if (/by-nc|by-sa|sampling/i.test(licence)) return null;
    const cc0 = /publicdomain\/zero/i.test(licence),
      by = /\/licenses\/by\/(\d\.\d)/i.exec(licence);
    if (!cc0 && !by) return null;
    if (!Number.isInteger(h.id)) throw new Error("Freesound result needs an ID.");
    const creator = str(h.username),
      name = str(h.name, `Freesound ${h.id}`),
      pageURL = str(h.url, `https://freesound.org/people/${creator}/sounds/${h.id}/`),
      download = str(object(h.previews ?? {})["preview-hq-mp3"]),
      licenceName = cc0 ? "CC0 1.0" : `CC BY ${by![1]}`;
    return decodeAsset({
      provider: "freesound",
      providerID: String(h.id),
      kind: "sfx",
      name,
      tags: list(h.tags),
      summary: str(h.description).replace(/<[^>]*>/g, ""),
      duration: num(h.duration),
      licenceClass: cc0 ? "noCredit" : "creditNeeded",
      licenceName,
      creditLine: cc0 ? undefined : `"${name}" by ${creator} (${pageURL}), ${licenceName}`,
      pageURL,
      previewURL: download,
      thumbnailURL: object(h.images ?? {}).waveform_m,
      remote: {
        download,
        creator,
        spdx: cc0 ? "CC0-1.0" : `CC-BY-${by![1]}`,
        licenceName,
        licenceURL: licence.replace(/^http:/, "https:"),
        quality: "hq-preview",
      },
    });
  };
  const params = (q: ProviderQuery) => ({
    filter: `license:("Creative Commons 0" OR "Attribution")${q.minDuration != null || q.maxDuration != null ? ` duration:[${q.minDuration ?? "*"} TO ${q.maxDuration ?? "*"}]` : ""}`,
    fields: "id,name,tags,description,duration,license,username,previews,images,url,num_downloads",
    page_size: Math.min(150, q.perPage),
    page: q.page,
  });
  return {
    info,
    async search(q, signal) {
      if (!wants(q, "sfx") || !q.text.trim()) return [];
      await http.requireReady();
      const data = object(
        await http.json(
          url("https://freesound.org/apiv2/search/", { query: q.text.trim(), ...params(q) }),
          signal,
          true,
        ),
      );
      return array(data.results)
        .map(map)
        .filter((a): a is Asset => a !== null);
    },
    async similar(asset, limit, signal) {
      await http.requireReady();
      if (!/^\d+$/.test(asset.providerID)) throw new Error("Invalid Freesound ID.");
      const data = object(
        await http.json(
          url(
            `https://freesound.org/apiv2/sounds/${asset.providerID}/similar/`,
            params({ text: "", kinds: [], page: 1, perPage: limit }),
          ),
          signal,
          true,
        ),
      );
      return array(data.results)
        .map(map)
        .filter((a): a is Asset => a !== null && a.id !== asset.id);
    },
    async fetch(asset, signal) {
      await http.requireReady();
      if (!asset.remote.download) throw new Error("Freesound preview is missing.");
      return { asset, files: [await http.file(asset.remote.download, "original.mp3", signal)] };
    },
  };
}
