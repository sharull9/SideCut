import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { decodeProjectFile, encodeProjectFile, type ProjectFile } from "@sidecut/contracts/project";
import { readZip, safeArchivePath } from "@sidecut/core/archive";
import { QueryError } from "@sidecut/core/project-queries";
import { object } from "@sidecut/core/interchange";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const exists = (path: string) =>
  stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

export function archiveCommands(before: ProjectFile, after: ProjectFile) {
  const wire = (file: ProjectFile) => object(JSON.parse(encodeProjectFile(file)).project);
  const a = wire(before),
    b = wire(after),
    commands: unknown[] = [];
  const changed = (old: unknown, next: unknown) => JSON.stringify(old) !== JSON.stringify(next);
  const oldMedia = before.project.media;
  for (const raw of b.media as unknown[]) {
    const item = object(raw),
      old = oldMedia.find((m) => m.id === item.id);
    const patch = Object.fromEntries(
      ["path", "look", "livePhotoVideo"]
        .filter((key) => changed(old?.[key], item[key]))
        .map((key) => [key, item[key] ?? null]),
    );
    if (Object.keys(patch).length) commands.push({ updateMedia: { mediaID: item.id, patch } });
  }
  const oldClips = [...before.project.videoTracks, ...before.project.audioTracks].flatMap(
    (t) => t.clips,
  );
  for (const track of [...(b.videoTracks as unknown[]), ...(b.audioTracks as unknown[])])
    for (const raw of object(track).clips as unknown[]) {
      const clip = object(raw),
        old = oldClips.find((c) => c.id === clip.id);
      if (
        changed(old?.video == null ? old?.video : JSON.parse(JSON.stringify(old.video)), clip.video)
      )
        commands.push({ updateClip: { clipID: clip.id, patch: { video: clip.video ?? null } } });
    }
  if (changed(a.metadata, b.metadata))
    commands.push({ updateProject: { patch: { metadata: b.metadata } } });
  return commands;
}

export async function folderArchive(
  projectPath: string,
  file: ProjectFile,
  bytes: Uint8Array,
  request: Record<string, unknown>,
  signal: AbortSignal,
  apply: (commands: unknown[]) => unknown,
) {
  const root = await realpath(dirname(projectPath)),
    entries = readZip(bytes);
  const archived = decodeProjectFile(
    JSON.parse(new TextDecoder().decode(entries["project.tandem"])),
  );
  const manifest = object(JSON.parse(new TextDecoder().decode(entries["manifest.json"])));
  if (!Array.isArray(manifest.resources))
    throw new QueryError("unavailable", "Invalid archive manifest.");
  const archive = request.to != null;
  const prefix = archive ? "" : `archive-${hash(bytes).slice(0, 12)}-`;
  const parent = archive ? resolve(root, String(request.to)) : root;
  // Resolve the nearest existing ancestor so dry runs also reject links back into the source.
  let ancestor = parent;
  while (!(await exists(ancestor))) {
    const next = dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  const canonical = resolve(await realpath(ancestor), relative(ancestor, parent));
  const folder = archive ? join(canonical, basename(root)) : root;
  if (
    archive &&
    (folder === root ||
      (!relative(root, folder).startsWith("..") && !isAbsolute(relative(root, folder))))
  )
    throw new QueryError(
      "badRequest",
      "Archive destination must be outside the managed project folder.",
    );
  if (archive && (await exists(folder)))
    throw new QueryError("badRequest", "Archive destination already exists.");
  const collected = manifest.resources.map((raw) => {
    const r = object(raw),
      path = safeArchivePath(String(r.path)),
      data = entries[path];
    if (!data) throw new QueryError("unavailable", "Archive resource is missing.");
    const item = file.project.media.find((m) => m.id === r.key);
    return {
      kind: String(r.key).startsWith("cache:")
        ? "cache"
        : String(r.key).startsWith("lut:")
          ? "lut"
          : "media",
      original: item?.path ?? String(r.key),
      path,
      bytes: data.length,
      sha256: hash(data),
      outcome: request.dryRun === true ? "planned" : "copied",
      usedBy: [String(r.key)],
    };
  });
  const missing = file.project.media
    .filter((m) => !collected.some((c) => c.usedBy.includes(m.id)))
    .map((m) => ({
      kind: "media",
      path: m.path,
      usedBy: [m.id],
      clips: [...file.project.videoTracks, ...file.project.audioTracks]
        .flatMap((t) => t.clips)
        .filter((c) => object(c.content.media ?? {}).mediaID === m.id).length,
    }));
  const commands = archiveCommands(file, archived);
  const result = {
    mode: archive ? "archive" : "consolidate",
    dryRun: request.dryRun === true,
    project: projectPath,
    folder,
    projectFile: join(folder, `${prefix}project.tandem`),
    openFile: join(folder, `${prefix}project.sidecut`),
    collected,
    madeRelative: commands.length,
    folderFiles: 0,
    folderBytes: 0,
    folderParts: [],
    copiedFiles: collected.length,
    copiedBytes: collected.reduce((sum, c) => sum + c.bytes, 0),
    reusedFiles: 0,
    missing,
    fonts: [],
    leftOut: [
      {
        path: "host profile",
        why: "The managed profile contains locks, credentials and databases; only project resources are copied.",
        files: 0,
        bytes: 0,
      },
    ],
    otherProjects: [],
    manifest: request.dryRun ? undefined : join(folder, `${prefix}archive.json`),
    revision:
      !archive && request.dryRun !== true && commands.length ? file.revision + 1 : file.revision,
    warnings: [
      "Open the returned openFile (.sidecut) to restore browser resources and included caches. Native folder versions, installed system fonts and recorder sidecars are not collected.",
    ],
  };
  if (request.dryRun === true) return result;
  signal.throwIfAborted();
  // Archive publication is atomic. Consolidation copies are immutable; undo changes paths only.
  await mkdir(canonical, { recursive: true });
  const staging = archive ? await mkdtemp(join(canonical, ".sidecut-archive-")) : root;
  try {
    for (const [name, data] of Object.entries({
      ...entries,
      "project.sidecut": bytes,
      "archive.json": new TextEncoder().encode(JSON.stringify(result, null, 2)),
    })) {
      signal.throwIfAborted();
      const clean = safeArchivePath(name.includes("/") ? name : `${prefix}${name}`),
        target = resolve(staging, clean);
      await mkdir(dirname(target), { recursive: true });
      const realParent = await realpath(dirname(target));
      const within = relative(staging, realParent);
      if (within.startsWith("..") || isAbsolute(within))
        throw new QueryError("badRequest", "Archive resource folder escapes its destination.");
      if (await exists(target)) {
        if (hash(await readFile(target)) !== hash(data))
          throw new QueryError("badRequest", `Archive would overwrite a different file: ${name}.`);
        const collectedFile = collected.find((c) => c.path === name);
        if (collectedFile) {
          collectedFile.outcome = "reused";
          result.reusedFiles++;
          result.copiedFiles--;
          result.copiedBytes -= data.length;
        }
      } else await writeFile(target, data, { flag: "wx" });
    }
    signal.throwIfAborted();
    if (archive) await rename(staging, folder);
    else if (commands.length) apply(commands);
    return result;
  } catch (error) {
    if (
      archive &&
      staging !== root &&
      dirname(staging) === canonical &&
      basename(staging).startsWith(".sidecut-archive-")
    )
      await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
