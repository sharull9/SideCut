import type { BrowserProjectSession } from "./browser-session";
import { AssetLibrary } from "@sidecut/platform-browser/asset-library";
import { BrowserAssetProviders } from "@sidecut/platform-browser/asset-providers";
import { SegmentLibrary } from "@sidecut/platform-browser/segments";
import { decodeAsset, licenceClasses } from "@sidecut/contracts/assets";
import { libraryLicence, libraryAssetDetails, generationServiceRequest } from "./service-assets";
import { starterAssets } from "@sidecut/platform-browser/starter";
import { projectCredits, creditsText } from "@sidecut/core/asset-use";
import { QueryError } from "@sidecut/core/project-queries";
import { readZip } from "@sidecut/core/archive";
import { segmentSummary, type SegmentField } from "@sidecut/core/segments";
import { object } from "@sidecut/core/interchange";

export async function libraryOperation(
  session: BrowserProjectSession,
  operation: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const initial = session.getSnapshot();
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
  if (["segments", "save-segment", "insert-segment"].includes(operation)) {
    if (operation === "save-segment") {
      if (typeof request.name !== "string" || !request.name.trim())
        throw new QueryError("badRequest", "A segment needs a name.");
      const clips = [
        ...session.getSnapshot().project.videoTracks,
        ...session.getSnapshot().project.audioTracks,
      ].flatMap((t) => t.clips);
      const explicit = [
        ...((request.clipIDs as string[] | undefined) ?? []),
        ...((request.clips as string[] | undefined) ?? []),
      ];
      if (!explicit.length && request.from == null && request.to == null)
        throw new QueryError("badRequest", "Say which clips to save: clipIDs, or from and to.");
      const ids = explicit.length
        ? explicit
        : clips
            .filter(
              (c) =>
                c.start.seconds >= Number(request.from ?? 0) &&
                c.start.seconds + c.duration.seconds <= Number(request.to ?? Infinity),
            )
            .map((c) => c.id);
      if (!ids.length) throw new QueryError("notFound", "No clip lies wholly between from and to.");
      const fields: SegmentField[] = (Array.isArray(request.fields) ? request.fields : []).map(
        (raw: unknown) => {
          if (typeof raw === "string") {
            const [clipID, label] = raw.split(/=(.*)/s);
            if (!clipID?.trim()) throw new QueryError("badRequest", "A field needs a clip ID.");
            return { clipID: clipID.trim(), ...(label?.trim() ? { label: label.trim() } : {}) };
          }
          const field = object(raw);
          if (
            typeof field.clipID !== "string" ||
            !field.clipID ||
            (field.label != null && typeof field.label !== "string") ||
            (field.key != null && typeof field.key !== "string")
          )
            throw new QueryError("badRequest", "Invalid segment field.");
          return {
            clipID: field.clipID,
            ...(typeof field.label === "string" ? { label: field.label } : {}),
            ...(typeof field.key === "string" ? { key: field.key } : {}),
          };
        },
      );
      const saved = await session.saveSelectionAsSegment(ids, request.name, {
        fields,
        replace: request.replace === true,
        signal,
      });
      return {
        segment: segmentSummary(
          saved,
          saved.resources.map((r) => r.path),
        ),
        clipIDs: ids,
        copied: saved.resources.map((r) => r.path),
        notes: saved.notes,
      };
    }
    const library = await SegmentLibrary.open();
    try {
      const { entries, problems } = await library.inspect();
      signal.throwIfAborted();
      if (operation === "segments")
        return {
          folder: "indexeddb:sidecut-segments",
          exists: true,
          segments: entries.map((e) =>
            segmentSummary(
              e.segment,
              Object.keys(e.resources).filter((p) => e.resources[p]?.state === "available"),
            ),
          ),
          problems,
        };
      const wanted = String(request.name).trim();
      const byID = entries.find((e) => e.segment.id === wanted);
      const exact = entries.filter((e) => e.segment.name === wanted);
      const matching = exact.length
        ? exact
        : entries.filter((e) => e.segment.name.toLowerCase() === wanted.toLowerCase());
      if (!byID && matching.length > 1)
        throw new QueryError(
          "badRequest",
          "Several segments have that name. Name one by its folder ID.",
        );
      const entry = byID ?? matching[0];
      if (!entry) throw new QueryError("notFound", "Saved segment was not found.");
      if (
        request.at == null ||
        !["place", "overwrite", "insert"].includes(String(request.mode ?? "place"))
      )
        throw new QueryError("badRequest", "Segment insert needs at and a valid mode.");
      const applied = await session.insertSavedSegment(
        entry,
        Number(request.at),
        request.mode as "place" | "overwrite" | "insert" | undefined,
        {
          values: request.values as Record<string, string> | undefined,
          label: request.label as string | undefined,
          author: request.author as string | undefined,
          expectedRevision: request.expectedRevision as number | undefined,
          signal,
        },
      );
      return {
        revision: applied.revision,
        segment: segmentSummary(entry.segment, Object.keys(entry.resources)),
        at: Number(request.at),
        applied,
      };
    } finally {
      library.close();
    }
  }
  const library = await AssetLibrary.open();
  try {
    const providers = new BrowserAssetProviders(library);
    if (operation === "assets-providers") return { providers: await providers.list(signal) };
    if (operation === "assets-install-starter") {
      const assets = starterAssets();
      await library.mergeRemote(assets);
      if (request.online === true)
        for (const asset of assets) {
          signal.throwIfAborted();
          await providers.fetch(asset, signal);
        }
      const counts: Record<string, number> = {};
      for (const asset of assets) counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
      return {
        counts,
        total: assets.length,
        assets: assets.length,
        downloaded: request.online === true,
        warnings: [],
      };
    }
    if (operation === "assets-credits") {
      const catalogue = [];
      for (const entry of await library.entries()) {
        signal.throwIfAborted();
        const licence = await libraryLicence(entry);
        catalogue.push(
          decodeAsset({
            ...entry.asset,
            ...(licenceClasses.some((c) => c === licence.licenceClass)
              ? { licenceClass: licence.licenceClass }
              : {}),
            ...(typeof licence.creditLine === "string" ? { creditLine: licence.creditLine } : {}),
            ...(typeof licence.name === "string" ? { licenceName: licence.name } : {}),
            remote: {
              ...entry.asset.remote,
              ...(typeof licence.holder === "string" ? { licenceHolder: licence.holder } : {}),
              ...(typeof licence.notes === "string" ? { licenceNotes: licence.notes } : {}),
            },
          }),
        );
      }
      const credits = projectCredits(session.getSnapshot().project, catalogue),
        includeOptional = request.includeOptional === true;
      return { text: creditsText(credits, includeOptional), credits, includeOptional };
    }
    if (operation === "assets-search") {
      const { searchServiceAssets } = await import("./service-assets");
      return searchServiceAssets(library, providers, request, signal);
    }
    if (operation === "assets-generate") {
      const generation = generationServiceRequest(request);
      if (request.confirmedPaid !== true)
        throw new QueryError("badRequest", "Generation requires confirmedPaid:true.");
      const result = await providers.generate(generation, true, signal);
      return { assets: result.entries.map((e) => e.asset), failures: result.failures };
    }
    if (typeof request.id !== "string")
      throw new QueryError("badRequest", "An asset id is required.");
    let entry = await library.get(request.id);
    if (
      !entry &&
      (operation === "assets-fetch" || operation === "assets-use") &&
      request.id.startsWith("fontsource:") &&
      request.online !== false
    ) {
      const found = await providers.search(
        "fontsource",
        {
          text: request.id.slice("fontsource:".length).replaceAll("-", " "),
          kinds: ["font"],
          perPage: 50,
        },
        signal,
      );
      await library.mergeRemote(found);
      entry = await library.get(request.id);
    }
    if (!entry)
      throw new QueryError(
        "notFound",
        "Asset was not found in the catalogue. Search or install starter metadata first.",
      );
    if (operation === "assets-fetch" || operation === "assets-use") {
      if (!entry.normalised && !entry.original && request.online === false)
        throw new QueryError(
          "badRequest",
          "This asset is not cached and online:false prevents its download.",
        );
      entry = await providers.fetch(entry.asset, signal);
    }
    signal.throwIfAborted();
    if (operation === "assets-use") {
      if (
        JSON.stringify(session.getSnapshot().project) !== JSON.stringify(initial.project) ||
        session.getSnapshot().revision !== initial.revision
      )
        throw new QueryError("unavailable", "Project changed while fetching the asset. Retry.");
      const used = await session.useLibraryAsset(entry, request, signal);
      return {
        revision: session.getSnapshot().revision,
        asset: entry.asset,
        ...used,
        licence: await libraryLicence(entry),
      };
    }
    const details = await libraryAssetDetails(entry);
    if (operation === "assets-fetch")
      return { asset: details.asset, file: details.file, licence: details.licence };
    return details;
  } finally {
    library.close();
  }
}
