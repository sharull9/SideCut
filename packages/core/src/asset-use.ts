// TandemAssets/Library/ProjectUse.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import type { Project, ProjectFile } from "@sidecut/contracts/project";
import { QueryError } from "./project-queries";

export const ASSET_USES = "sidecut.assetUses";
export interface AssetUse {
  asset: Asset;
  mediaID?: string;
  path?: string;
}
export function assetUses(project: Project): AssetUse[] {
  const raw = project.metadata[ASSET_USES];
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error("Project asset-use metadata is invalid.");
  return values.map((v) => {
    if (!v || typeof v !== "object" || !("asset" in v)) throw new Error("Invalid asset use.");
    return { ...v, asset: decodeAsset(v.asset) } as AssetUse;
  });
}
export function recordAssetUse(project: Project, use: AssetUse) {
  const uses = assetUses(project),
    index = uses.findIndex((v) => v.asset.id === use.asset.id);
  if (index < 0) uses.push(use);
  else uses[index] = use;
  return { ...project.metadata, [ASSET_USES]: JSON.stringify(uses) };
}
export const assetSuggestions = (kind: Asset["kind"]) => {
  if (kind === "music")
    return { role: "music", track: "Music", audio: { gainDB: -31, fadeOut: 2 } };
  if (kind === "sfx") return { role: "sfx", track: "SFX", audio: { gainDB: -15 } };
  if (kind === "sticker") return { role: "sticker", track: "Graphics" };
  if (["overlay", "icon", "logo"].includes(kind)) return { role: "graphic", track: "Graphics" };
  if (kind === "video" || kind === "image") return { role: "broll", track: "B-roll" };
  if (kind === "title") return { role: "graphic", track: "Text" };
  return { role: "other", track: null };
};
export function assetUsePlan(
  file: ProjectFile,
  asset: Asset,
  resource: { mediaID: string; path: string },
  request: Record<string, unknown> = {},
) {
  if (request.mode != null && !["place", "overwrite", "insert"].includes(String(request.mode)))
    throw new QueryError("badRequest", "Unknown asset placement mode.");
  if (
    request.anchor != null &&
    ![
      "bottom",
      "bottomLeft",
      "bottomRight",
      "top",
      "topLeft",
      "topRight",
      "centre",
      "lowerThird",
    ].includes(String(request.anchor))
  )
    throw new QueryError("badRequest", "Unknown sticker anchor.");
  if (request.duration != null && !(Number(request.duration) > 0))
    throw new QueryError("badRequest", "Asset duration must be positive.");
  if (request.at != null && !(Number(request.at) >= 0))
    throw new QueryError("badRequest", "Asset placement must start at or after zero.");
  if (["title", "transition"].includes(asset.kind))
    throw new QueryError(
      "notImplemented",
      "Title and transition library assets cannot be installed yet.",
    );
  const nonMedia = asset.kind === "font" || asset.kind === "lut",
    known = file.project.media.find((m) => m.id === resource.mediaID || m.path === resource.path),
    mediaID = nonMedia ? undefined : (known?.id ?? resource.mediaID),
    path = known?.path ?? resource.path,
    suggestions = assetSuggestions(asset.kind),
    commands: unknown[] = [];
  if (!nonMedia && !known) {
    const kind =
      asset.remote.mediaKind ??
      (asset.kind === "sfx" || asset.kind === "music"
        ? "audio"
        : asset.kind === "video" ||
            (["sticker", "overlay"].includes(asset.kind) && asset.duration != null)
          ? "video"
          : "image");
    commands.push({
      addMedia: {
        item: {
          id: mediaID,
          path,
          kind,
          role: suggestions.role,
          hasVideo:
            kind === "image" ||
            (asset.remote.hasVideo != null ? asset.remote.hasVideo === "1" : kind !== "audio"),
          hasAudio:
            asset.remote.hasAudio != null ? asset.remote.hasAudio === "1" : kind === "audio",
          width: asset.width ?? null,
          height: asset.height ?? null,
          duration: kind === "image" ? null : (asset.duration ?? null),
          hasAlpha: asset.hasAlpha ?? false,
          asset,
        },
      },
    });
  }
  if (!nonMedia && request.at != null)
    commands.push({
      placeMedia: {
        mediaIDs: [mediaID],
        at: request.at,
        ...(request.duration != null ? { duration: request.duration } : {}),
        ...(request.mode != null ? { mode: request.mode } : {}),
        ...(request.anchor != null ? { anchor: request.anchor } : {}),
        ...(request.pop != null ? { pop: request.pop } : {}),
      },
    });
  const metadata = recordAssetUse(file.project, { asset, ...(mediaID ? { mediaID } : {}), path });
  if (metadata[ASSET_USES] !== file.project.metadata[ASSET_USES])
    commands.push({ updateProject: { patch: { metadata } } });
  return {
    commands,
    mediaID,
    path,
    role: suggestions.role,
    trackName: suggestions.track,
    gainDB: suggestions.audio?.gainDB,
  };
}
export function projectCredits(project: Project, catalogue: readonly Asset[] = []) {
  const known = new Map(catalogue.map((a) => [a.id, a]));
  const ids = new Set<string>();
  const metadataWarnings: string[] = [];
  let uses: AssetUse[] = [];
  try {
    uses = assetUses(project);
  } catch {
    metadataWarnings.push(
      "Project asset-use metadata could not be read. Check the downloaded project before publishing credits.",
    );
  }
  for (const use of uses) {
    if (!known.has(use.asset.id)) known.set(use.asset.id, use.asset);
    if (!use.mediaID || project.media.some((m) => m.id === use.mediaID || m.path === use.path))
      ids.add(use.asset.id);
  }
  for (const media of project.media)
    if (media.asset) {
      try {
        const asset = decodeAsset(media.asset);
        if (!known.has(asset.id)) known.set(asset.id, asset);
        ids.add(asset.id);
      } catch {
        metadataWarnings.push(`Asset metadata for ${media.path} could not be read.`);
      }
    }
  for (const track of [...project.videoTracks, ...project.audioTracks])
    for (const clip of track.clips)
      for (const tag of clip.tags)
        if (tag.startsWith("asset:") && tag.length > 6) ids.add(tag.slice(6));
  const entries: {
      line: string;
      required: boolean;
      licenceClass: string;
      assetIDs: string[];
      assetNames: string[];
    }[] = [],
    warnings: string[] = [...metadataWarnings],
    assets: {
      id: string;
      name: string;
      provider: string;
      licenceClass: string;
      licence: string | null;
    }[] = [];
  const subscriptions = new Map<string, { count: number; notes: string | undefined }>(),
    unknown: string[] = [],
    missing: string[] = [];
  for (const id of ids) {
    const a = known.get(id),
      name = a?.name ?? id,
      licenceClass = a?.licenceClass ?? "unknown",
      line = a?.creditLine?.trim();
    assets.push({
      id,
      name,
      provider: a?.provider ?? id.split(":")[0]!,
      licenceClass,
      licence: typeof a?.licenceName === "string" ? a.licenceName : null,
    });
    if (licenceClass === "unknown") unknown.push(name);
    if (licenceClass === "creditNeeded" && !line) missing.push(name);
    if (licenceClass === "subscription") {
      const source = a?.remote.licenceHolder ?? a?.licenceName ?? a?.provider ?? "a subscription",
        old = subscriptions.get(source);
      subscriptions.set(source, {
        count: (old?.count ?? 0) + 1,
        notes: old?.notes ?? a?.remote.licenceNotes,
      });
    }
    if (!line) continue;
    const required = licenceClass === "creditNeeded" || licenceClass === "unknown",
      old = entries.find((e) => e.line === line);
    if (old) {
      old.assetIDs.push(id);
      old.assetNames.push(name);
      old.required ||= required;
    } else entries.push({ line, required, licenceClass, assetIDs: [id], assetNames: [name] });
  }
  const names = (values: string[]) =>
    values.length < 2
      ? `"${values[0]}"`
      : values
          .slice(0, -1)
          .map((v) => `"${v}"`)
          .join(", ") + ` and "${values.at(-1)}"`;
  if (unknown.length)
    warnings.push(
      `No licence on record for ${names(unknown)}. Add a tandem-licence.json to their import folder, or replace them.`,
    );
  if (missing.length)
    warnings.push(
      `${names(missing)} ${missing.length === 1 ? "needs a credit but has" : "need a credit but have"} no credit line. Check the licence and write one.`,
    );
  for (const [source, entry] of subscriptions)
    warnings.push(
      `${entry.count} ${entry.count === 1 ? "asset" : "assets"} from ${source}. ${entry.notes ?? "Covered only while the subscription is active on a plan that allows this channel."}`,
    );
  return { entries, warnings, assets };
}
export function creditsText(report: ReturnType<typeof projectCredits>, includeOptional = false) {
  const required = report.entries.filter((e) => e.required).map((e) => e.line),
    optional = includeOptional ? report.entries.filter((e) => !e.required).map((e) => e.line) : [];
  if (!required.length && !optional.length) return "";
  return [
    "Credits",
    ...required,
    ...(optional.length ? [...(required.length ? [""] : []), "Thanks to", ...optional] : []),
  ].join("\n");
}
