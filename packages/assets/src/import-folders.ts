// Browser-selected folder equivalent of TandemAssets ImportFolders/SharedLibraryProvider.
import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import { title } from "./provider.ts";
export interface FolderFile {
  path: string;
  size?: number;
}
export function folderAssets(
  files: readonly FolderFile[],
  provider: "shared" | "import",
  notes: Readonly<Record<string, unknown>> = {},
): Asset[] {
  const seen = new Set<string>(),
    assets: Asset[] = [];
  for (const file of files) {
    const parts = file.path.replaceAll("\\", "/").split("/");
    if (parts.some((p) => !p || p === ".." || p === "."))
      throw new Error("Folder paths must stay inside the selected root.");
    if (
      parts.some(
        (p) => p.startsWith(".") || ["node_modules", "__MACOSX", "cache", "derived"].includes(p),
      ) ||
      (provider === "shared" && parts[0]?.toLowerCase() === "segments")
    )
      continue;
    const name = parts.at(-1)!,
      ext = name.split(".").at(-1)!.toLowerCase();
    let kind: Asset["kind"] | undefined;
    if (["wav", "mp3", "m4a", "flac", "ogg", "opus", "aiff"].includes(ext))
      kind = /music/i.test(parts.join("/")) ? "music" : "sfx";
    else if (["mp4", "mov", "webm", "m4v"].includes(ext)) kind = "video";
    else if (["png", "jpg", "jpeg", "svg", "gif", "webp", "apng", "avif"].includes(ext))
      kind = "image";
    else if (["ttf", "otf", "woff", "woff2"].includes(ext)) kind = "font";
    else if (ext === "cube") kind = "lut";
    else if (ext === "json" && name !== "tandem-licence.json") kind = "sticker";
    if (!kind || seen.has(file.path)) continue;
    if (provider === "shared" && kind !== "font" && kind !== "lut") {
      if (/^stickers$/i.test(parts[0]!)) kind = "sticker";
      else if (/^graphics$/i.test(parts[0]!)) kind = "overlay";
    }
    let note: Record<string, unknown> = {};
    for (let i = 0; i < parts.length; i++) {
      const value = notes[parts.slice(0, i).join("/")];
      if (value && typeof value === "object" && !Array.isArray(value))
        note = value as Record<string, unknown>;
    }
    if ((kind === "music" || kind === "sfx") && (note.kind === "music" || note.kind === "sfx"))
      kind = note.kind;
    seen.add(file.path);
    assets.push(
      decodeAsset({
        provider,
        providerID: file.path,
        kind,
        name: title(name.replace(/\.[^.]+$/, "")),
        tags: parts.slice(0, -1),
        licenceClass: note.licenceClass ?? "unknown",
        creditLine: note.credit,
        licenceName: note.licence,
        remote: {
          relativePath: file.path,
          folder: parts[0] ?? "library",
          source: typeof note.source === "string" ? note.source : "Local folder",
        },
      }),
    );
  }
  return assets;
}
