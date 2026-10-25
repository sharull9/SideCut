import { assetKinds, type Asset } from "@sidecut/contracts/assets";
import type { AssetLibrary } from "@sidecut/platform-browser/asset-library";
import type { BrowserAssetProviders } from "@sidecut/platform-browser/asset-providers";
import { QueryError } from "@sidecut/core/project-queries";
import { assetLicence } from "@sidecut/platform-browser/asset-providers";
import type { LibraryEntry } from "@sidecut/platform-browser/asset-library";
import { object } from "@sidecut/core/interchange";
import { decodeGeneration } from "@sidecut/contracts/providers";

export async function libraryLicence(entry: LibraryEntry): Promise<Record<string, unknown>> {
  if (entry.licence) {
    try {
      return object(JSON.parse(await entry.licence.text()));
    } catch {
      /* Hand-imported licences can be plain text. */
    }
  }
  return assetLicence(entry.asset);
}
export async function libraryAssetDetails(entry: LibraryEntry) {
  return {
    asset: entry.asset,
    file: entry.normalised?.name,
    original: entry.original?.name,
    licence: await libraryLicence(entry),
    prompt: entry.asset.remote.prompt,
    model: entry.asset.remote.model,
  };
}
export function generationServiceRequest(request: Record<string, unknown>) {
  const name = String(request.kind ?? "").toLowerCase(),
    kind = ["sound", "sounds", "effects"].includes(name)
      ? "sfx"
      : name === "songs"
        ? "music"
        : name;
  if (!["sfx", "music"].includes(kind))
    throw new QueryError("badRequest", "Generate makes sfx or music.");
  try {
    return decodeGeneration({
      prompt: request.prompt,
      kind,
      duration: request.duration,
      variations: request.variations,
      loop: request.loop,
      instrumental: request.vocals !== true,
    });
  } catch (error) {
    throw new QueryError(
      "badRequest",
      error instanceof Error ? error.message : "Invalid generation request.",
    );
  }
}

export async function searchServiceAssets(
  library: Pick<AssetLibrary, "entries" | "mergeRemote">,
  providers: Pick<BrowserAssetProviders, "list" | "search">,
  request: Record<string, unknown>,
  signal: AbortSignal,
) {
  const text = String(request.text ?? ""),
    limit = Math.max(1, Math.min(Number(request.limit ?? 20), 200)),
    list = (key: string): string[] =>
      Array.isArray(request[key]) ? request[key].filter((v) => typeof v === "string") : [],
    selected = [...new Set([...list("providers"), ...list("provider")])],
    aliases: Record<string, string> = {
      sound: "sfx",
      sounds: "sfx",
      effects: "sfx",
      songs: "music",
      emoji: "sticker",
      broll: "video",
      "b-roll": "video",
    },
    kinds = [...list("kinds"), ...list("kind")].map((v) => {
      const lower = v.toLowerCase(),
        kind = aliases[lower] ?? (assetKinds.some((k) => k === lower) ? lower : lower.slice(0, -1));
      if (!assetKinds.some((k) => k === kind))
        throw new QueryError("badRequest", `Unknown asset kind: ${v}.`);
      return kind;
    });
  if (text.length > 1000 || (request.maxDuration != null && Number(request.maxDuration) < 0))
    throw new QueryError("badRequest", "Invalid asset text or duration.");
  signal.throwIfAborted();
  const info = await providers.list(signal);
  for (const id of selected)
    if (!info.some((p) => p.id === id))
      throw new QueryError("notFound", `Unknown asset provider: ${id}.`);
  const online: { provider: string; assets: Asset[]; error?: string }[] = [];
  if (request.online === true) {
    for (const provider of info.filter(
      (p) =>
        p.capabilities.search &&
        (!selected.length || selected.includes(p.id)) &&
        (!kinds.length || p.kinds.some((k) => kinds.includes(k))) &&
        (selected.length || ["ready", "limited"].includes(p.status.state)),
    )) {
      signal.throwIfAborted();
      try {
        if (!["ready", "limited"].includes(provider.status.state))
          throw new Error(provider.status.message ?? provider.status.state);
        const assets = await providers.search(
          provider.id,
          { text, kinds, perPage: limit, maxDuration: request.maxDuration },
          signal,
        );
        signal.throwIfAborted();
        await library.mergeRemote(assets);
        online.push({ provider: provider.id, assets });
      } catch (error) {
        signal.throwIfAborted();
        online.push({
          provider: provider.id,
          assets: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  signal.throwIfAborted();
  const matches = (await library.entries(text))
    .map((e) => e.asset)
    .filter(
      (a) =>
        (!kinds.length || kinds.includes(a.kind)) &&
        (!selected.length || selected.includes(a.provider)) &&
        (request.maxDuration == null ||
          a.duration == null ||
          a.duration <= Number(request.maxDuration)),
    );
  return {
    text,
    local: matches.slice(0, limit),
    total: matches.length,
    ...(request.online === true ? { online } : {}),
  };
}
