import { DurableStorage } from "./sqlite-client";
export type CachedFrame = Blob | { frameFile: string; type: string };
export async function storeFrame(image: Blob): Promise<CachedFrame> {
  const db = await DurableStorage.open();
  return {
    frameFile: await db.putFile(new Uint8Array(await image.arrayBuffer())),
    type: image.type,
  };
}
export async function readFrame(image: CachedFrame): Promise<Blob> {
  if (image instanceof Blob) return image;
  const db = await DurableStorage.open();
  return new Blob([await db.getFile(image.frameFile)], { type: image.type });
}
export async function removeFrames(frames: readonly { image: CachedFrame }[]) {
  const db = await DurableStorage.open();
  for (const { image } of frames)
    if (!(image instanceof Blob)) await db.removeFile(image.frameFile);
}
/** Archives contain actual frame bytes, never references to another profile's files. */
export async function portableFrameReferences(
  value: unknown,
  maximumBytes = 256 * 1024 * 1024,
): Promise<unknown> {
  let bytes = 0;
  const visit = async (item: unknown): Promise<unknown> => {
    if (
      !item ||
      typeof item !== "object" ||
      item instanceof Blob ||
      ArrayBuffer.isView(item) ||
      item instanceof ArrayBuffer
    )
      return item;
    if (
      "frameFile" in item &&
      typeof item.frameFile === "string" &&
      "type" in item &&
      typeof item.type === "string"
    ) {
      const image = await readFrame({ frameFile: item.frameFile, type: item.type });
      bytes += image.size;
      if (bytes > maximumBytes)
        throw new Error("Derived frames exceed the archive resource budget.");
      return image;
    }
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      for (const entry of item) result.push(await visit(entry));
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(item)) result[key] = await visit(entry);
    return result;
  };
  return visit(value);
}
