import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { decodeProjectFile, encodeProjectFile, type ProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { makeSegment } from "./segments";
import { ASSET_USES, assetUses } from "./asset-use";

const LIMIT = 256 * 1024 * 1024;
export function safeArchivePath(path: string) {
  if (
    !path ||
    path.length > 512 ||
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("Unsafe archive path.");
  return path;
}
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > LIMIT) throw new Error("Archive exceeds the 256 MiB limit.");
  let total = 0,
    count = 0;
  const names = new Set<string>();
  return unzipSync(bytes, {
    filter: (entry) => {
      const name = entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name;
      safeArchivePath(name);
      if (names.has(name)) throw new Error("Duplicate archive entry.");
      names.add(name);
      total += entry.originalSize;
      if (++count > 10000 || total > LIMIT) throw new Error("Expanded archive exceeds limits.");
      return !entry.name.endsWith("/");
    },
  });
}
export interface ArchiveResource {
  key: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}
export function createArchive(
  file: ProjectFile,
  resources: readonly ArchiveResource[],
  options: { allowMissing?: boolean; preserveIdentity?: boolean } = {},
) {
  new ProjectCoordinator(file).getSnapshot();
  const entries: Record<string, Uint8Array> = Object.create(null);
  const paths = new Map<string, string>();
  const keys = new Set<string>();
  const uses = assetUses(file.project);
  const manifest = resources.map((resource, index) => {
    if (keys.has(resource.key)) throw new Error("Duplicate archive resource.");
    keys.add(resource.key);
    const path = `media/${index}-${resource.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "resource"}`;
    entries[path] = resource.bytes;
    const media = file.project.media.find((m) => m.id === resource.key);
    if (media) paths.set(media.path, path);
    if (resource.key.startsWith("lut:")) paths.set(resource.key.slice(4), path);
    if (resource.key.startsWith("asset-file:")) {
      const source = uses.find((use) => resource.key === `asset-file:${use.asset.id}`)?.path;
      if (source && !paths.has(source)) paths.set(source, path);
    }
    return { key: resource.key, path, type: resource.type, name: resource.name };
  });
  for (const item of file.project.media)
    if (!keys.has(item.id) && !options.allowMissing)
      throw new Error(`Cannot archive missing source: ${item.path}`);
  const requireLUTs = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(requireLUTs);
    else if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      const params = node.params as Record<string, unknown> | undefined;
      if (
        node.type === "lut" &&
        typeof params?.path === "string" &&
        !keys.has(`lut:${params.path}`)
      )
        throw new Error(`Cannot archive missing LUT: ${params.path}`);
      Object.values(node).forEach(requireLUTs);
    }
  };
  if (!options.allowMissing) requireLUTs(file.project);
  const clipIDs = [...file.project.videoTracks, ...file.project.audioTracks].flatMap((track) =>
    track.clips.map((clip) => clip.id),
  );
  if (clipIDs.length && !options.allowMissing)
    for (const resource of makeSegment(file.project, clipIDs, "archive").resources)
      if (!resource.optional && !keys.has(resource.key))
        throw new Error(`Cannot archive missing resource: ${resource.key}`);
  for (const use of assetUses(file.project))
    if (!use.mediaID && !keys.has(`asset-file:${use.asset.id}`) && !options.allowMissing)
      throw new Error(`Cannot archive missing library asset: ${use.asset.name}`);
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") return paths.get(value) ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    return value;
  };
  const project = rewrite(JSON.parse(encodeProjectFile(file)).project) as Record<string, unknown>;
  const metadata = project.metadata as Record<string, string>;
  if (metadata[ASSET_USES])
    metadata[ASSET_USES] = JSON.stringify(rewrite(JSON.parse(metadata[ASSET_USES])));
  // An archive is an independent snapshot; old journal paths must not replay over it.
  if (!options.preserveIdentity)
    project.id = `prj_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  entries["project.tandem"] = strToU8(
    encodeProjectFile(
      decodeProjectFile({ revision: options.preserveIdentity ? file.revision : 0, project }),
    ),
  );
  entries["manifest.json"] = strToU8(
    JSON.stringify({
      version: 1,
      allowMissing: options.allowMissing === true,
      resources: manifest.map((r) => ({
        ...r,
        key: r.key.startsWith("lut:") ? `lut:${paths.get(r.key.slice(4)) ?? r.path}` : r.key,
      })),
    }),
  );
  const total = Object.values(entries).reduce((sum, bytes) => sum + bytes.length, 0);
  if (total > LIMIT) throw new Error("Archive exceeds the 256 MiB limit.");
  return zipSync(entries, { level: 0 });
}
export function openArchive(bytes: Uint8Array) {
  const entries = readZip(bytes);
  if (!entries["project.tandem"] || !entries["manifest.json"])
    throw new Error("Invalid SideCut archive.");
  const decoded = decodeProjectFile(JSON.parse(strFromU8(entries["project.tandem"])));
  const file = decodeProjectFile({
    revision: 0,
    project: {
      ...JSON.parse(encodeProjectFile(decoded)).project,
      id: `prj_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
    },
  });
  new ProjectCoordinator(file).getSnapshot();
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  if (manifest.version !== 1 || !Array.isArray(manifest.resources))
    throw new Error("Invalid archive manifest.");
  const keys = new Set<string>();
  const resources: ArchiveResource[] = manifest.resources.map((r: Record<string, unknown>) => {
    if (
      typeof r.key !== "string" ||
      typeof r.path !== "string" ||
      typeof r.name !== "string" ||
      typeof r.type !== "string" ||
      keys.has(r.key)
    )
      throw new Error("Invalid archive resource.");
    keys.add(r.key);
    const resourceBytes = entries[safeArchivePath(r.path)];
    if (!resourceBytes) throw new Error("Archive resource is missing.");
    return { key: r.key, name: r.name, type: r.type, bytes: resourceBytes };
  });
  for (const media of file.project.media) {
    if (keys.has(media.id)) safeArchivePath(media.path);
    if (!keys.has(media.id) && manifest.allowMissing !== true)
      throw new Error("Archive media is missing.");
  }
  return { file, resources };
}
