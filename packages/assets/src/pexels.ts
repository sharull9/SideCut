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
export function pexelsProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo("pexels", "Pexels", ["video", "image"], {
      requestsPerWindow: 200,
      window: 3600,
      notes: ["Results are from Pexels. Creator credits are appreciated."],
    }),
    http = new ProviderHTTP(env, info);
  const map = (raw: unknown, video: boolean): Asset | null => {
    const h = object(raw);
    if (!Number.isInteger(h.id)) throw new Error("Pexels result needs an ID.");
    let original: Record<string, unknown> | undefined,
      download = "",
      preview = "";
    const fallback = `Pexels ${video ? "video" : "photo"} ${h.id}`,
      slug = str(h.url).split("/").filter(Boolean).at(-1)?.replace(/-\d+$/, "") ?? fallback,
      name = video ? title(slug) : str(h.alt) || title(slug),
      user = video && h.user ? object(h.user) : {},
      creator = video
        ? str(user.name, "a Pexels creator")
        : str(h.photographer, "a Pexels photographer");
    if (video) {
      const files = array(h.video_files ?? [])
        .map(object)
        .filter((f) => str(f.file_type) === "video/mp4" && str(f.link))
        .sort((a, b) => (num(a.width) ?? 0) - (num(b.width) ?? 0));
      original = files.filter((f) => (num(f.width) ?? 0) <= 3840).at(-1) ?? files.at(-1);
      if (!original) return null;
      download = str(original.link);
      preview = str((files.find((f) => (num(f.width) ?? 0) >= 640) ?? files[0])?.link);
    } else {
      const src = object(h.src ?? {});
      download = str(src.original ?? src.large2x);
      preview = str(src.medium ?? src.small);
    }
    if (!download) return null;
    return decodeAsset({
      provider: "pexels",
      providerID: `${video ? "video" : "photo"}-${h.id}`,
      kind: video ? "video" : "image",
      name,
      tags: name.toLowerCase().split(/\W+/).filter(Boolean),
      duration: video ? num(h.duration) : undefined,
      width: num(original?.width ?? h.width),
      height: num(original?.height ?? h.height),
      licenceClass: "noCredit",
      licenceName: "Pexels License",
      creditLine: `${video ? "Video" : "Photo"} by ${creator} on Pexels`,
      pageURL: h.url,
      previewURL: preview,
      thumbnailURL: video ? h.image : object(h.src ?? {}).small,
      remote: {
        download,
        creator,
        ...(str(video ? user.url : h.photographer_url)
          ? { creatorURL: str(video ? user.url : h.photographer_url) }
          : {}),
      },
    });
  };
  return {
    info,
    async search(q, signal) {
      if (!q.text.trim()) return [];
      await http.requireReady();
      const result: Asset[] = [];
      for (const video of [true, false]) {
        if (!wants(q, video ? "video" : "image")) continue;
        const data = object(
          await http.json(
            url(
              video ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search",
              { query: q.text.trim(), per_page: Math.min(80, q.perPage), page: q.page },
            ),
            signal,
            true,
          ),
        );
        result.push(
          ...array(video ? data.videos : data.photos)
            .map((h) => map(h, video))
            .filter((a): a is Asset => a !== null),
        );
      }
      return result;
    },
    async fetch(asset, signal) {
      await http.requireReady();
      if (!asset.remote.download) throw new Error("Pexels download link is missing.");
      return {
        asset,
        files: [
          await http.file(
            asset.remote.download,
            asset.kind === "video" ? "original.mp4" : "original.jpg",
            signal,
          ),
        ],
      };
    },
  };
}
