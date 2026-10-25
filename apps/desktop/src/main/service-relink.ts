import { lstat, open, realpath, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ProjectFile } from "@sidecut/contracts/project";
import { QueryError, clipMediaID } from "@sidecut/core/project-queries";

const contentID = (value: string) => value.replace(/^(\d+)-\d+-/, "$1-");
export async function fileFingerprint(path: string, signal: AbortSignal) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat(),
      span = 1048576;
    const first = Buffer.alloc(Math.min(span, info.size)),
      last = Buffer.alloc(Math.max(0, info.size - Math.max(span, info.size - span)));
    await handle.read(first, 0, first.length, 0);
    await handle.read(last, 0, last.length, Math.max(span, info.size - span));
    signal.throwIfAborted();
    return `${info.size}-${Math.trunc(info.mtimeMs)}-${createHash("sha256").update(first).update(last).digest("hex")}`;
  } finally {
    await handle.close();
  }
}

export async function relinkPlan(
  file: ProjectFile,
  projectRoot: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
) {
  const root = await realpath(projectRoot),
    roots = [
      ...new Set([
        root,
        ...(Array.isArray(request.search)
          ? request.search.map((p) => resolve(root, String(p)))
          : []),
      ]),
    ];
  for (const path of roots) {
    signal.throwIfAborted();
    if (!(await stat(path).catch(() => null))?.isDirectory())
      throw new QueryError("notFound", `There's no folder at ${path} to search.`);
  }
  const missing = [];
  for (const media of file.project.media) {
    signal.throwIfAborted();
    if (!(await stat(resolve(root, media.path)).catch(() => null))?.isFile()) missing.push(media);
  }
  const names = new Set(missing.map((m) => basename(m.path.replaceAll("\\", "/")).toLowerCase())),
    candidates = new Map<string, string[]>(),
    seen = new Set<string>();
  let budget = 500000;
  const walk = async (path: string): Promise<void> => {
    if (!names.size) return;
    signal.throwIfAborted();
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      signal.throwIfAborted();
      if (--budget < 0)
        throw new QueryError(
          "badRequest",
          "Relink scan exceeds 500,000 entries; choose a smaller search folder.",
        );
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink())
        continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && names.has(entry.name.toLowerCase())) {
        const real = await realpath(child);
        if (seen.has(real)) continue;
        seen.add(real);
        const key = entry.name.toLowerCase();
        candidates.set(key, [...(candidates.get(key) ?? []), real]);
      }
    }
  };
  for (const path of roots) await walk(path);
  const found: {
      mediaID: string;
      from: string;
      to: string;
      absolute: string;
      fingerprint: string;
      livePhotoVideo?: string;
    }[] = [],
    ambiguous = new Set<string>();
  const stored = (path: string) => {
    const rel = relative(root, path);
    return rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel)
      ? rel.replaceAll("\\", "/")
      : path;
  };
  for (const media of missing) {
    const files = candidates.get(basename(media.path.replaceAll("\\", "/")).toLowerCase()) ?? [];
    let chosen: string | undefined,
      fingerprint = "";
    if (media.fingerprint && /^\d+-\d+-[0-9a-f]{64}$/i.test(media.fingerprint)) {
      for (const path of files) {
        const print = await fileFingerprint(path, signal);
        if (contentID(print) === contentID(media.fingerprint)) {
          chosen = path;
          fingerprint = print;
          break;
        }
      }
    } else if (files.length === 1) {
      chosen = files[0];
      fingerprint = await fileFingerprint(chosen!, signal);
    } else if (files.length > 1) ambiguous.add(media.id);
    if (chosen) {
      // Files are transported through the existing bounded renderer resource channel.
      if ((await lstat(chosen)).size > 64 * 1024 * 1024)
        throw new QueryError("badRequest", "Relink source exceeds 64 MiB.");
      const movie = media.livePhotoVideo
        ? join(dirname(chosen), basename(media.livePhotoVideo.replaceAll("\\", "/")))
        : undefined;
      found.push({
        mediaID: media.id,
        from: media.path,
        to: stored(chosen),
        absolute: chosen,
        fingerprint,
        ...(movie && (await lstat(movie).catch(() => null))?.isFile()
          ? { livePhotoVideo: stored(movie) }
          : {}),
      });
    }
  }
  const counts = new Map<string, number>();
  for (const clip of [...file.project.videoTracks, ...file.project.audioTracks].flatMap(
    (t) => t.clips,
  )) {
    const id = clipMediaID(clip);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    result: {
      revision: file.revision,
      dryRun: request.dryRun === true,
      searched: roots,
      relinked: found.map(({ mediaID, from, to }) => ({ mediaID, from, to })),
      missing: missing
        .filter((m) => !found.some((f) => f.mediaID === m.id))
        .map((m) => ({
          mediaID: m.id,
          path: m.path,
          clips: counts.get(m.id) ?? 0,
          ambiguous: ambiguous.has(m.id),
        })),
    },
    found,
    commands: found.map(({ mediaID, to, livePhotoVideo }) => ({
      updateMedia: { mediaID, patch: { path: to, ...(livePhotoVideo ? { livePhotoVideo } : {}) } },
    })),
  };
}
