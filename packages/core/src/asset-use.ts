// TandemAssets/Library/ProjectUse.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import type { Project } from "@sidecut/contracts/project";

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
  const uses = assetUses(project).filter((v) => v.asset.id !== use.asset.id);
  return { ...project.metadata, [ASSET_USES]: JSON.stringify([...uses, use]) };
}
export const assetSuggestions = (kind: Asset["kind"]) => {
  if (kind === "music")
    return { role: "music", track: "Music", audio: { gainDB: -31, fadeOut: 2 } };
  if (kind === "sfx") return { role: "sfx", track: "SFX", audio: { gainDB: -15 } };
  if (kind === "sticker") return { role: "sticker", track: "Graphics" };
  if (["overlay", "icon", "logo"].includes(kind)) return { role: "graphic", track: "Graphics" };
  if (kind === "video" || kind === "image") return { role: "broll", track: "B-roll" };
  return { role: "other", track: null };
};
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
    known.set(use.asset.id, use.asset);
    if (!use.mediaID || project.media.some((m) => m.id === use.mediaID || m.path === use.path))
      ids.add(use.asset.id);
  }
  for (const media of project.media)
    if (media.asset) {
      try {
        const asset = decodeAsset(media.asset);
        known.set(asset.id, asset);
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
  const subscriptions = new Map<string, number>();
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
    if (licenceClass === "unknown")
      warnings.push(`No licence on record for "${name}". Check its terms or replace it.`);
    if (licenceClass === "creditNeeded" && !line)
      warnings.push(
        `"${name}" needs a credit but has no credit line. Check the licence and write one.`,
      );
    if (licenceClass === "subscription")
      subscriptions.set(
        a?.provider ?? "subscription",
        (subscriptions.get(a?.provider ?? "subscription") ?? 0) + 1,
      );
    if (!line) continue;
    const required = licenceClass === "creditNeeded" || licenceClass === "unknown",
      old = entries.find((e) => e.line === line);
    if (old) {
      old.assetIDs.push(id);
      old.assetNames.push(name);
      old.required ||= required;
    } else entries.push({ line, required, licenceClass, assetIDs: [id], assetNames: [name] });
  }
  for (const [provider, count] of subscriptions)
    warnings.push(
      `${count} asset(s) from ${provider}. Check that your active subscription covers this channel.`,
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
