import { open, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { QueryError } from "@sidecut/core/project-queries";

// CLI outputs are snapshots. The running host retains ownership of its SQLite project.
export async function writeProjectCommandOutput(
  projectPath: string,
  requested: string,
  json: string,
  signal: AbortSignal,
) {
  const root = await realpath(dirname(projectPath));
  let target = resolve(root, requested);
  if ((await stat(target).catch(() => null))?.isDirectory())
    target = resolve(target, basename(target) + ".tandem");
  else if (extname(target) !== ".tandem") target += ".tandem";
  const folder = await realpath(dirname(target));
  const within = relative(root, folder);
  if (
    within.startsWith("..") ||
    isAbsolute(within) ||
    /[:*?"<>|]/.test(basename(target)) ||
    /[. ]$/.test(basename(target)) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename(target))
  )
    throw new QueryError("badRequest", "Project outputs must stay inside the host project folder.");
  target = resolve(folder, basename(target));
  if (target === resolve(projectPath))
    throw new QueryError("badRequest", "Choose a snapshot path other than the managed project.");
  signal.throwIfAborted();
  const file = await open(target, "wx");
  try {
    await file.writeFile(json);
    signal.throwIfAborted();
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(target).catch(() => {});
    throw error;
  }
  await file.close();
  return target;
}
