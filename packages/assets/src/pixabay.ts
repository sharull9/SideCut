import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import {
  ProviderHTTP,
  providerInfo,
  object,
  array,
  str,
  num,
  wants,
  url,
  title,
  type Provider,
  type ProviderEnvironment,
} from "./provider.ts";
export function pixabayProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo("pixabay", "Pixabay", ["video", "image"], {
      requestsPerWindow: 100,
      window: 60,
      cacheTTL: 86400,
      notes: ["Cache responses for 24 hours. Download before use. Results are from Pixabay."],
    }),
    http = new ProviderHTTP(env, info);
  const map = (raw: unknown, video: boolean): Asset | null => {
    const h = object(raw);
    if (!Number.isInteger(h.id)) throw new Error("Pixabay result needs an ID.");
    const tags = str(h.tags)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      creator = str(h.user, "a Pixabay creator");
    let download = "",
      preview = "",
      width = num(h.imageWidth),
      height = num(h.imageHeight),
      thumbnail = str(h.previewURL);
    if (video) {
      const videos = object(h.videos),
        renditions = ["large", "medium", "small", "tiny"]
          .map((k) => videos[k])
          .filter((v) => v && str(object(v).url))
          .map(object);
      const original = renditions[0];
      if (!original) return null;
      download = str(original.url);
      width = num(original.width);
      height = num(original.height);
      preview = str(
        (videos.tiny ?? videos.small ?? original) &&
          object(videos.tiny ?? videos.small ?? original).url,
      );
      thumbnail = str(object(videos.medium ?? original).thumbnail);
    } else {
      download = str(h.imageURL ?? h.fullHDURL ?? h.largeImageURL);
      preview = str(h.webformatURL);
    }
    if (!download) return null;
    return decodeAsset({
      provider: "pixabay",
      providerID: `${video ? "video" : "image"}-${h.id}`,
      kind: video ? "video" : "image",
      name: tags.length
        ? title(tags.slice(0, 3).join(", "))
        : `Pixabay ${video ? "video" : "image"} ${h.id}`,
      tags,
      duration: video ? num(h.duration) : undefined,
      width,
      height,
      licenceClass: "noCredit",
      licenceName: "Pixabay Content License",
      creditLine: `${video ? "Video" : "Image"} by ${creator} from Pixabay`,
      pageURL: h.pageURL,
      previewURL: preview || undefined,
      thumbnailURL: thumbnail || undefined,
      updatedAt: new Date(env.now?.() ?? Date.now()).toISOString(),
      remote: { download, creator },
    });
  };
  return {
    info,
    async search(q, signal) {
      if (!q.text.trim()) return [];
      await http.requireReady();
      const results: Asset[] = [];
      for (const video of [true, false]) {
        if (!wants(q, video ? "video" : "image")) continue;
        const link = url(video ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/", {
          q: q.text.trim().slice(0, 100),
          per_page: Math.min(200, Math.max(3, q.perPage)),
          page: q.page,
          safesearch: "true",
          ...(video ? {} : { image_type: "photo" }),
        });
        const data = object(await http.json(link, signal, true));
        results.push(
          ...array(data.hits)
            .map((h) => map(h, video))
            .filter((a): a is Asset => a !== null),
        );
      }
      return results;
    },
    async fetch(asset, signal) {
      await http.requireReady();
      let current = asset;
      const age = (env.now?.() ?? Date.now()) - Date.parse(asset.updatedAt ?? "");
      if (!Number.isFinite(age) || age > 23 * 3600000) {
        const video = asset.kind === "video",
          id = asset.providerID.replace(/^(video|image)-/, "");
        if (!/^\d+$/.test(id)) throw new Error("Invalid Pixabay asset ID.");
        const data = object(
            await http.json(
              url(video ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/", { id }),
              signal,
              true,
            ),
          ),
          fresh = array(data.hits)[0];
        if (fresh) {
          const mapped = map(fresh, video);
          if (mapped)
            current = { ...asset, remote: mapped.remote, previewURL: mapped.previewURL ?? null };
        }
      }
      if (!current.remote.download) throw new Error("Pixabay download link is missing.");
      return {
        asset: current,
        files: [
          await http.file(
            current.remote.download,
            asset.kind === "video" ? "original.mp4" : "original.jpg",
            signal,
          ),
        ],
      };
    },
  };
}
