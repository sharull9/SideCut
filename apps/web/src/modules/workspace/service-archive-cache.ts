import { derivedCache } from "@sidecut/platform-browser/derived-cache";
import { audioIdentity } from "@sidecut/platform-browser/audio-analysis";
import { MATTE_VERSION } from "@sidecut/platform-browser/cutout";
import { encodeStored, decodeStored } from "@sidecut/platform-browser/storage-codec";
import type { ArchiveResource } from "@sidecut/core/archive";
import { TRANSCRIPT_VERSION } from "@sidecut/platform-browser/transcription";
import { portableFrameReferences } from "@sidecut/platform-browser/frame-store";
import { RVM_MODEL } from "@sidecut/platform-browser/matting-models";
import { transcriptVersion } from "@sidecut/platform-browser/transcription-config";
import { readPreference } from "@sidecut/platform-browser/preferences";

export async function archiveCaches(stored: { resource: { file: File } }[]) {
  const resources: ArchiveResource[] = [],
    rows: { key: string; value: string }[] = [];
  const storage = {
    putFile: async (bytes: Uint8Array) => {
      const name = `blob-${resources.length}`;
      resources.push({ key: `cache:${name}`, name, type: "application/octet-stream", bytes });
      return name;
    },
  };
  for (const { resource } of stored) {
    const identity = await audioIdentity(resource.file);
    for (const key of [
      `samples:1:${identity}`,
      `proxy:png:1:640:${identity}`,
      `${MATTE_VERSION}:${identity}`,
      `${RVM_MODEL.version}:${identity}`,
      `${TRANSCRIPT_VERSION}:${identity}`,
      `${transcriptVersion(readPreference("sidecut.transcription.language") ?? "en")}:${identity}`,
    ]) {
      const value = await derivedCache(key);
      if (value !== undefined && !rows.some((row) => row.key === key))
        rows.push({
          key,
          value: await encodeStored(await portableFrameReferences(value), storage),
        });
    }
  }
  resources.push({
    key: "cache:index",
    name: "cache.json",
    type: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(rows)),
  });
  return resources;
}

export async function restoreArchiveCaches(resources: readonly ArchiveResource[]) {
  const index = resources.find((r) => r.key === "cache:index");
  if (!index) return;
  const rows: unknown = JSON.parse(new TextDecoder().decode(index.bytes));
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error("Invalid archive cache index.");
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.key !== "string" ||
      typeof row.value !== "string" ||
      !/^(samples:1:|proxy:png:1:640:|matte:|transcript:[23]:)/.test(row.key)
    )
      throw new Error("Invalid archive cache entry.");
    const value = await decodeStored(row.value, {
      getFile: async (id) => {
        const resource = resources.find((r) => r.key === `cache:${id}`);
        if (!resource) throw new Error("Missing archive cache blob.");
        return resource.bytes.slice();
      },
    });
    await derivedCache(row.key, value);
  }
}
