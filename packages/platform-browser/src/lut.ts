import { parseCube } from "@sidecut/core/cube-lut";
import type { CubeLUT } from "@sidecut/core/cube-lut";
import type { LocalResource } from "./storage";
export function createLUTLoader(resource: (id: string) => Promise<LocalResource | null>) {
  const cache = new Map<string, { identity: string; lut: CubeLUT }>();
  return async (path: string): Promise<CubeLUT> => {
    const local = await resource(`lut:${path}`);
    if (!local || local.state !== "available")
      throw new Error(`LUT "${path}" is missing. Import its .cube file on this device.`);
    const identity = `${local.file.name}:${local.file.size}:${local.file.lastModified}:${local.detail}`;
    const previous = cache.get(path);
    if (previous?.identity === identity) return previous.lut;
    if (local.file.size > 32 * 1024 * 1024)
      throw new Error("LUT exceeds the browser's 32 MB limit.");
    const lut = parseCube(await local.file.text());
    cache.set(path, { identity, lut });
    return lut;
  };
}
