import type { DurableStorage } from "./sqlite-client";
import { encodeStored, decodeStored } from "./storage-codec";
import { migrateLibrary } from "./legacy-storage";
import { decodeAsset, searchAssets, type Asset } from "@sidecut/contracts/assets";
import { parseCube } from "@sidecut/core/cube-lut";
import { openAnimatedImage, openLottie } from "./animation";
import { importFont } from "./text";

export interface LibraryEntry {
  asset: Asset;
  original?: File;
  normalised?: File;
  licence?: File;
  fontFamily?: string;
  extras?: File[];
}
function libraryEntry(value: unknown): LibraryEntry {
  if (!value || typeof value !== "object" || !("asset" in value))
    throw new Error("Invalid stored asset.");
  const entry: LibraryEntry = { asset: decodeAsset(value.asset) };
  const file = (raw: unknown) => {
    if (!(raw instanceof File)) throw new Error("Invalid asset file.");
    return raw;
  };
  if ("original" in value && value.original !== undefined) entry.original = file(value.original);
  if ("normalised" in value && value.normalised !== undefined)
    entry.normalised = file(value.normalised);
  if ("licence" in value && value.licence !== undefined) entry.licence = file(value.licence);
  if ("fontFamily" in value) {
    if (typeof value.fontFamily !== "string") throw new Error("Invalid font family.");
    entry.fontFamily = value.fontFamily;
  }
  if ("extras" in value) {
    if (!Array.isArray(value.extras) || !value.extras.every((v: unknown) => v instanceof File))
      throw new Error("Invalid asset extra files.");
    entry.extras = value.extras;
  }
  return entry;
}
export class AssetLibrary {
  private constructor(private db: DurableStorage) {}
  static async open() {
    return new AssetLibrary(
      await migrateLibrary("assets", "sidecut-assets", "assets", libraryEntry),
    );
  }
  async entries(query = "", kind = "", licence = "") {
    const rows = await this.db.request({ type: "read", collection: "assets" });
    const values = await Promise.all(
      rows.map(async (r) => libraryEntry(await decodeStored(r.value, this.db))),
    );
    const ids = new Set(
      searchAssets(
        values.map((v) => v.asset),
        query,
        kind,
        licence,
      ).map((a) => a.id),
    );
    return values
      .filter((v) => ids.has(v.asset.id))
      .sort((a, b) => a.asset.name.localeCompare(b.asset.name));
  }
  async get(id: string) {
    const row = (await this.db.request({ type: "read", collection: "assets", key: id }))[0];
    return row ? libraryEntry(await decodeStored(row.value, this.db)) : undefined;
  }
  async put(entry: LibraryEntry) {
    const validated = libraryEntry(entry);
    await this.db.request({
      type: "commit",
      checks: [],
      writes: [
        {
          collection: "assets",
          key: validated.asset.id,
          value: await encodeStored(validated, this.db),
        },
      ],
    });
  }
  async mergeRemote(assets: readonly Asset[]) {
    const decoded = assets.map(decodeAsset);
    const existing = new Set(
      (await this.db.request({ type: "read", collection: "assets" })).map((r) => r.key),
    );
    const missing = decoded.filter((a) => !existing.has(a.id));
    if (!missing.length) return;
    try {
      await this.db.request({
        type: "commit",
        checks: missing.map((a) => ({ collection: "assets", key: a.id, value: null })),
        writes: await Promise.all(
          missing.map(async (asset) => ({
            collection: "assets" as const,
            key: asset.id,
            value: await encodeStored({ asset }, this.db),
          })),
        ),
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Save conflict:")) throw error;
      // A confirmed conflict wrote nothing; preserve the newly added rows and retry the rest.
      await this.mergeRemote(decoded);
    }
  }
  close() {
    /* Shared page connection. */
  }
}
export const libraryState = (entry: LibraryEntry) =>
  entry.normalised ? "available" : entry.original ? "needs normalization" : "missing file";

export function validateSVG(text: string) {
  if (text.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("SVG is too large or contains external entities.");
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  if (xml.querySelector("parsererror") || xml.documentElement.localName !== "svg")
    throw new Error("Invalid SVG document.");
  for (const el of xml.querySelectorAll("*")) {
    if (
      [
        "script",
        "foreignobject",
        "iframe",
        "image",
        "audio",
        "video",
        "animate",
        "animatemotion",
        "animatetransform",
        "set",
      ].includes(el.localName.toLowerCase())
    )
      throw new Error("SVG must be static and self-contained, without scripts or embedded media.");
    for (const attr of el.attributes)
      if (attr.name !== "xmlns" && !attr.name.startsWith("xmlns:"))
        if (
          /^on/i.test(attr.name) ||
          /(?:@import|javascript:|https?:|data:|file:|\/\/)/i.test(attr.value) ||
          /url\(\s*["']?(?!#)/i.test(attr.value) ||
          (/href$/i.test(attr.name) && !attr.value.startsWith("#"))
        )
          throw new Error("SVG external references and active content are unsupported.");
    if (el.localName === "style" && /@import|url\(|https?:|javascript:/i.test(el.textContent ?? ""))
      throw new Error("SVG external styles are unsupported.");
  }
  return new XMLSerializer().serializeToString(xml);
}
export async function normalizeAsset(
  file: File,
  metadata: unknown,
  licence?: File,
): Promise<LibraryEntry> {
  if (file.size > 64 * 1024 * 1024) throw new Error("Library assets must be smaller than 64 MiB.");
  if (licence && licence.size > 1024 * 1024)
    throw new Error("Licence files must be smaller than 1 MiB.");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const base = decodeAsset(metadata);
  let normalised = file,
    width: number | undefined,
    height: number | undefined,
    duration: number | undefined,
    fontFamily: string | undefined,
    hasAlpha = false;
  let mediaKind: string | undefined;
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  if (base.kind === "lut") {
    if (ext !== "cube") throw new Error("Choose a .cube LUT.");
    parseCube(await file.text());
  } else if (base.kind === "font") {
    if (!licence) throw new Error("Choose the font's licence file before importing it.");
    fontFamily = await importFont(file);
  } else if (
    ["music", "sfx", "video"].includes(base.kind) ||
    /\.(mp4|webm|mov|m4v)$/i.test(file.name)
  ) {
    const { probeLocalFile } = await import("./media");
    const probe = await probeLocalFile(file);
    if (probe.resource.state !== "available") throw new Error(probe.resource.detail);
    if (
      (base.kind === "video" && !probe.item.hasVideo) ||
      (base.kind !== "video" && !probe.item.hasAudio)
    )
      throw new Error("Asset kind does not match its media tracks.");
    width = probe.item.width;
    height = probe.item.height;
    duration = probe.item.duration;
    mediaKind = probe.item.kind;
  } else if (["image", "icon", "logo", "sticker", "overlay"].includes(base.kind)) {
    let animation: Awaited<ReturnType<typeof openLottie>> | null = null;
    if (ext === "json" || ext === "lottie") {
      if (ext === "lottie")
        throw new Error(
          "Compressed .lottie archives are unsupported. Choose the exported Lottie JSON.",
        );
      animation = await openLottie(file);
      normalised = new File([await file.text()], `${hash}.json`, {
        type: "application/x-sidecut-lottie",
      });
    } else if (["gif", "webp", "png", "apng"].includes(ext ?? ""))
      animation = await openAnimatedImage(file);
    if (animation) {
      try {
        width = animation.width;
        height = animation.height;
        duration = animation.duration;
        hasAlpha = true;
        await animation.frame(0);
      } finally {
        animation.close();
      }
    } else {
      const source =
        ext === "svg"
          ? new Blob([validateSVG(await file.text())], { type: "image/svg+xml" })
          : file;
      const url = URL.createObjectURL(source);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
        width = Math.max(1, Math.round(image.naturalWidth * scale));
        height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
        const png = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Image normalization failed."))),
            "image/png",
          ),
        );
        normalised = new File([png], `${hash}.png`, { type: "image/png" });
        hasAlpha = true;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } else
    throw new Error(
      `Local normalization for ${base.kind} is unavailable. Use Project media for audio and video.`,
    );
  const folder = `${encodeURIComponent(base.provider)}/${encodeURIComponent(base.providerID)}`;
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const asset = decodeAsset({
    ...base,
    state: "normalised",
    sha256: hash,
    width,
    height,
    duration,
    hasAlpha,
    remote: { ...base.remote, ...(mediaKind ? { mediaKind } : {}) },
    files: {
      folder,
      original: `original-${safe(file.name)}`,
      normalised: safe(normalised.name),
      ...(licence ? { licence: `licence-${safe(licence.name)}` } : {}),
    },
    ...(fontFamily ? { fontFamily } : {}),
  });
  return {
    asset,
    original: file,
    normalised,
    ...(licence ? { licence } : {}),
    ...(fontFamily ? { fontFamily } : {}),
  };
}
