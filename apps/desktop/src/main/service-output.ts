import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { safeArchivePath } from "@sidecut/core/archive";
import { QueryError } from "@sidecut/core/project-queries";
export async function serviceOutput(
  projectPath: string,
  name: string,
  bytes: Uint8Array,
  signal: AbortSignal,
) {
  if (bytes.length > 256 * 1024 * 1024)
    throw new QueryError("badRequest", "Output exceeds 256 MiB.");
  const clean = safeArchivePath(name),
    filename = clean.startsWith("exports/") ? clean.slice(8) : clean;
  if (
    filename.includes("/") ||
    /[:*?"<>|]/.test(filename) ||
    /[. ]$/.test(filename) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)
  )
    throw new QueryError(
      "badRequest",
      "Outputs must be filenames inside the project's exports folder.",
    );
  const root = await realpath(dirname(projectPath)),
    folder = resolve(root, "exports");
  await mkdir(folder, { recursive: true });
  const canonical = await realpath(folder),
    within = relative(root, canonical);
  if (within.startsWith("..") || isAbsolute(within))
    throw new QueryError("badRequest", "Output folder escapes the project.");
  signal.throwIfAborted();
  const path = resolve(canonical, filename),
    file = await open(path, "wx");
  try {
    await file.writeFile(bytes);
    signal.throwIfAborted();
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(path).catch(() => {});
    throw error;
  }
  await file.close();
  return path;
}
