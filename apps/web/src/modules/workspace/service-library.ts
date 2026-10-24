import type { BrowserProjectSession } from "./browser-session";
import { AssetLibrary } from "@sidecut/platform-browser/asset-library";
import { BrowserAssetProviders, assetLicence } from "@sidecut/platform-browser/asset-providers";
import { SegmentLibrary } from "@sidecut/platform-browser/segments";
import { starterAssets } from "@sidecut/platform-browser/starter";
import { projectCredits, creditsText } from "@sidecut/core/asset-use";
import { QueryError } from "@sidecut/core/project-queries";
import { readZip } from "@sidecut/core/archive";
import { object } from "@sidecut/core/interchange";

export async function libraryOperation(
  session: BrowserProjectSession,
  operation: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  if (operation === "archive") {
    const bytes = await session.archiveBytes({
      allowMissing: request.output == null,
      preserveIdentity: request.output == null,
      withCache: request.withCache === true,
    });
    if (request.output == null && request.to == null && request.dryRun !== true) {
      // LUT references use their path as the resource key; stage the new key before the host edit.
      const entries = readZip(bytes),
        manifest = object(JSON.parse(new TextDecoder().decode(entries["manifest.json"])));
      for (const raw of Array.isArray(manifest.resources) ? manifest.resources : []) {
        const resource = object(raw);
        if (
          typeof resource.key === "string" &&
          resource.key.startsWith("lut:") &&
          typeof resource.path === "string" &&
          entries[resource.path]
        )
          await session.stageServiceResource(
            session.getSnapshot().project.id,
            resource.key,
            new File([entries[resource.path]!.slice().buffer], String(resource.name), {
              type: String(resource.type),
            }),
            signal,
          );
      }
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]!);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([bytes.slice().buffer]));
    });
    return { data };
  }
  if (operation === "wait") {
    const { waitService } = await import("./service-wait");
    return waitService(session, request, signal);
  }
  if (operation === "assets-credits") {
    const credits = projectCredits(session.getSnapshot().project),
      includeOptional = request.includeOptional === true;
    return { text: creditsText(credits, includeOptional), credits, includeOptional };
  }
  if (["segments", "save-segment", "insert-segment"].includes(operation)) {
    if (operation === "save-segment") {
      if (typeof request.name !== "string" || !request.name.trim())
        throw new QueryError("badRequest", "A segment needs a name.");
      const clips = [
        ...session.getSnapshot().project.videoTracks,
        ...session.getSnapshot().project.audioTracks,
      ].flatMap((t) => t.clips);
      const ids =
        (request.clipIDs as string[] | undefined) ??
        clips
          .filter(
            (c) =>
              c.start.seconds >= Number(request.from ?? 0) &&
              c.start.seconds + c.duration.seconds <= Number(request.to ?? Infinity),
          )
          .map((c) => c.id);
      if (!ids.length)
        throw new QueryError("badRequest", "Select at least one clip for the segment.");
      return {
        segment: await session.saveSelectionAsSegment(ids, request.name),
        clipIDs: ids,
        notes: [],
      };
    }
    const library = await SegmentLibrary.open();
    try {
      const entries = await library.list();
      signal.throwIfAborted();
      if (operation === "segments")
        return {
          folder: "indexeddb:sidecut-segments",
          exists: true,
          segments: entries.map((e) => e.segment),
          problems: [],
        };
      const entry = entries.find(
        (e) => e.segment.name === request.name || e.segment.id === request.name,
      );
      if (!entry) throw new QueryError("notFound", "Saved segment was not found.");
      if (
        request.at == null ||
        !["place", "overwrite", "insert"].includes(String(request.mode ?? "place"))
      )
        throw new QueryError("badRequest", "Segment insert needs at and a valid mode.");
      await session.insertSavedSegment(
        entry,
        Number(request.at),
        request.mode as "place" | "overwrite" | "insert" | undefined,
      );
      return { revision: session.getSnapshot().revision, segment: entry.segment.id };
    } finally {
      library.close();
    }
  }
  const library = await AssetLibrary.open();
  try {
    const providers = new BrowserAssetProviders(library);
    if (operation === "assets-providers") return { providers: await providers.list() };
    if (operation === "assets-install-starter") {
      const assets = starterAssets();
      await library.mergeRemote(assets);
      if (request.online === true)
        for (const asset of assets) {
          signal.throwIfAborted();
          await providers.fetch(asset, signal);
        }
      return {
        assets: assets.length,
        downloaded: request.online === true,
        warnings:
          request.online === true
            ? []
            : ["Installed catalogue metadata. Downloads require online:true."],
      };
    }
    if (operation === "assets-search") {
      const text = String(request.text ?? ""),
        limit = Number(request.limit ?? 30);
      if (limit < 1 || limit > 150)
        throw new QueryError("badRequest", "Asset search limit must be 1-150.");
      const kinds = request.kinds as string[] | undefined,
        selected = request.providers as string[] | undefined;
      const matches = (await library.entries(text))
        .map((e) => e.asset)
        .filter(
          (a) =>
            (!kinds?.length || kinds.includes(a.kind)) &&
            (!selected?.length || selected.includes(a.provider)) &&
            (request.maxDuration == null ||
              a.duration == null ||
              a.duration <= Number(request.maxDuration)),
        );
      const online = [];
      if (request.online === true) {
        if (!selected?.length)
          throw new QueryError("badRequest", "Choose providers explicitly for an online search.");
        for (const id of selected) {
          signal.throwIfAborted();
          const assets = await providers.search(
            id,
            { text, kinds, perPage: limit, maxDuration: request.maxDuration },
            signal,
          );
          await library.mergeRemote(assets);
          online.push({ provider: id, assets });
        }
      }
      return {
        text,
        local: matches.slice(0, limit),
        total: matches.length,
        ...(request.online === true ? { online } : {}),
      };
    }
    if (operation === "assets-generate") {
      if (request.confirmedPaid !== true)
        throw new QueryError("badRequest", "Generation requires confirmedPaid:true.");
      const result = await providers.generate(
        {
          prompt: request.prompt,
          kind: request.kind,
          duration: request.duration,
          variations: request.variations,
          loop: request.loop,
          instrumental: request.vocals !== true,
        },
        true,
        signal,
      );
      return { assets: result.entries.map((e) => e.asset), failures: result.failures };
    }
    if (typeof request.id !== "string")
      throw new QueryError("badRequest", "An asset id is required.");
    let entry = await library.get(request.id);
    if (!entry)
      throw new QueryError(
        "notFound",
        "Asset was not found in the catalogue. Search or install starter metadata first.",
      );
    if (operation === "assets-fetch") {
      if (!entry.normalised && !entry.original && request.online !== true)
        throw new QueryError("badRequest", "Downloading an asset requires online:true.");
      entry = await providers.fetch(entry.asset, signal);
    }
    signal.throwIfAborted();
    if (operation === "assets-use") {
      if (["at", "duration", "mode", "anchor", "pop"].some((key) => request[key] != null))
        throw new QueryError(
          "notImplemented",
          "Asset use currently adds project media/fonts/LUTs. Timeline placement options are pending.",
        );
      const used = await session.useLibraryAsset(entry);
      return { revision: session.getSnapshot().revision, asset: entry.asset, ...used };
    }
    return {
      asset: entry.asset,
      file: entry.normalised?.name,
      original: entry.original?.name,
      licence: assetLicence(entry.asset),
    };
  } finally {
    library.close();
  }
}
