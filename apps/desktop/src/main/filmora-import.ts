import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { importFilmora, object } from "@sidecut/core/interchange";
import { safeArchivePath } from "@sidecut/core/archive";

export async function readFilmoraSource(path: string, keepLevels: boolean, signal: AbortSignal) {
  const root = await realpath(path);
  const info = await stat(root);
  if (!info.isDirectory()) {
    if (info.size > 20 * 1024 * 1024) throw new Error("Project import exceeds 20 MiB.");
    return importFilmora(await readFile(root, { signal }), { keepLevels });
  }
  let folder = root;
  try {
    await stat(resolve(root, "ProjectFolder/project_info.json"));
    folder = resolve(root, "ProjectFolder");
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
  let total = 0;
  const entries: Record<string, Uint8Array> = Object.create(null);
  const read = async (name: string) => {
    safeArchivePath(name);
    const source = await realpath(resolve(folder, name));
    const within = relative(root, source);
    if (within.startsWith("..") || isAbsolute(within))
      throw new Error("Filmora metadata escapes the selected folder.");
    total += (await stat(source)).size;
    if (total > 20 * 1024 * 1024) throw new Error("Filmora folder metadata exceeds 20 MiB.");
    const bytes = await readFile(source, { signal });
    entries[name] = bytes;
    return bytes;
  };
  const metadata = object(JSON.parse(new TextDecoder().decode(await read("project_info.json"))));
  if (typeof metadata.timeline_mediaId !== "string")
    throw new Error("Missing Filmora timeline_mediaId.");
  const id = safeArchivePath(metadata.timeline_mediaId);
  await read(`Medias/${id}/timeline.wesproj`);
  try {
    await read(`Medias/${id}/extra.json`);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
  return importFilmora(entries, { keepLevels });
}
