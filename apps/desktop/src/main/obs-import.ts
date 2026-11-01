import { open, realpath, stat } from "node:fs/promises";
import { relative, resolve, isAbsolute, extname } from "node:path";
import {
  importOBS,
  obsCollection,
  obsImageRequests,
  type OBSImage,
} from "@sidecut/core/obs-import";
import { safeArchivePath } from "@sidecut/core/archive";

function within(root: string, path: string) {
  const rel = relative(root, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
}
async function readText(path: string, limit: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit)
      throw new Error("OBS metadata is not a bounded regular file.");
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const chunk = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!chunk.bytesRead) break;
      offset += chunk.bytesRead;
    }
    if (offset !== info.size) throw new Error("OBS metadata changed during import.");
    return bytes
      .subarray(0, offset)
      .toString("utf8")
      .replace(/^\uFEFF/, "");
  } finally {
    await file.close();
  }
}

/** Parse only PNG structure/dimensions, without invoking codecs, plugins, or external references. */
async function pngInfo(path: string, signal: AbortSignal) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 45 || info.size > 16 * 1024 * 1024)
      throw new Error("Invalid PNG resource size.");
    const header = Buffer.alloc(33);
    if (
      (await file.read(header, 0, 33, 0)).bytesRead !== 33 ||
      header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      header.readUInt32BE(8) !== 13 ||
      header.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("Invalid PNG header.");
    const width = header.readUInt32BE(16),
      height = header.readUInt32BE(20);
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216)
      throw new Error("PNG exceeds the 16-megapixel source limit.");
    let offset = 33,
      imageData = false;
    const chunk = Buffer.alloc(8);
    for (let count = 0; count < 1024 && offset + 12 <= info.size; count++) {
      signal.throwIfAborted();
      if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) break;
      const length = chunk.readUInt32BE(0),
        type = chunk.toString("ascii", 4, 8);
      if (offset + length + 12 > info.size) break;
      if (type === "acTL") throw new Error("Animated PNG is unsupported.");
      if (type === "IDAT") imageData = true;
      offset += length + 12;
      if (type === "IEND" && length === 0 && imageData && offset === info.size)
        return { width, height, bytes: info.size };
    }
    throw new Error("Invalid PNG chunk structure.");
  } finally {
    await file.close();
  }
}

export async function readOBSSource(
  path: string,
  options: {
    projectRoot: string;
    profile?: string;
    assetRoot?: string;
    scene?: string;
    duration?: number;
  },
  signal: AbortSignal,
) {
  const collection = obsCollection(JSON.parse(await readText(path, 20 * 1024 * 1024, signal)));
  const profile = options.profile ? await readText(options.profile, 65536, signal) : undefined;
  const projectRoot = await realpath(options.projectRoot);
  const assetRoot = options.assetRoot ? await realpath(options.assetRoot) : undefined;
  if (assetRoot && (!within(projectRoot, assetRoot) || !(await stat(assetRoot)).isDirectory()))
    throw new Error("OBS asset root must be a folder inside the host project folder.");
  const images = new Map<string, OBSImage | { error: string }>();
  const cache = new Map<string, OBSImage>();
  let total = 0;
  for (const source of obsImageRequests(collection)) {
    signal.throwIfAborted();
    if (!assetRoot) {
      images.set(source.name, { error: "No asset root approved; image skipped." });
      continue;
    }
    try {
      const value = source.settings.file;
      if (
        typeof value !== "string" ||
        value.length > 2048 ||
        Array.from(value).some((character) => character.charCodeAt(0) < 32) ||
        /^[/\\]{2}/.test(value) ||
        (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[/\\]/i.test(value)) ||
        value.split(/[/\\]/).includes("..")
      )
        throw new Error("Unsupported image reference.");
      const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
      if (!isAbsolute(value)) safeArchivePath(normalized);
      const candidate = resolve(assetRoot, isAbsolute(value) ? value : normalized);
      if (!within(assetRoot, candidate) || extname(candidate).toLowerCase() !== ".png")
        throw new Error("Unapproved image path/type.");
      const resolved = await realpath(candidate);
      if (!within(assetRoot, resolved) || !within(projectRoot, resolved))
        throw new Error("Image escapes its approved root.");
      const cached = cache.get(resolved);
      if (cached) {
        images.set(source.name, cached);
        continue;
      }
      if (cache.size >= 64) throw new Error("OBS image count limit reached.");
      const info = await pngInfo(resolved, signal);
      total += info.bytes;
      if (total > 64 * 1024 * 1024) throw new Error("OBS image budget exceeded.");
      const image = {
        path: safeArchivePath(relative(projectRoot, resolved).replaceAll("\\", "/")),
        width: info.width,
        height: info.height,
      };
      cache.set(resolved, image);
      images.set(source.name, image);
    } catch {
      signal.throwIfAborted();
      images.set(source.name, {
        error: "Image unavailable, unsafe or outside the supported PNG limits; item skipped.",
      });
    }
  }
  signal.throwIfAborted();
  return importOBS(collection, {
    ...(profile !== undefined ? { profile } : {}),
    ...(options.scene !== undefined ? { scene: options.scene } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    images,
  });
}
