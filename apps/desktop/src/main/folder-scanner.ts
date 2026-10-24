import { readdir, lstat, readFile, realpath } from "node:fs/promises";
import { join, extname, relative, isAbsolute } from "node:path";
import type { FolderMedia } from "@sidecut/contracts/desktop";

// Ported role/exclusion rules from pinned TandemMedia/MediaScanner.swift.
const skipped = new Set([".tandem", "exports", "node_modules", ".build", ".git"]);
export { mediaRole } from "@sidecut/core/media-role";
import { video, audio, images, mediaRole } from "@sidecut/core/media-role";
interface Candidate {
  size: number;
  modified: number;
  signature: string;
}
export async function scanFolder(root: string): Promise<Map<string, Candidate>> {
  const result = new Map<string, Candidate>();
  const walk = async (folder: string, subfolder: string, depth: number) => {
    if (depth > 32) throw new Error("Media folder nesting exceeds 32 levels.");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        skipped.has(entry.name.toLowerCase()) ||
        entry.isSymbolicLink() ||
        (entry.isDirectory() && entry.name.toLowerCase().endsWith(".wfp.dir"))
      )
        continue;
      const path = join(folder, entry.name),
        name = subfolder ? `${subfolder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path, name, depth + 1);
      else if (
        entry.isFile() &&
        [video, audio, images].some((set) => set.has(extname(entry.name).slice(1).toLowerCase()))
      ) {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size === 0) continue;
        if (info.size > 256 * 1024 * 1024)
          throw new Error(`${name} exceeds the current 256 MiB native import limit.`);
        result.set(name, {
          size: info.size,
          modified: info.mtimeMs,
          signature: `${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
        });
        if (result.size > 10_000) throw new Error("Media folder exceeds 10,000 files.");
      }
    }
  };
  await walk(root, "", 0);
  return result;
}

// Polling uses the same settle rule on all desktop platforms and discovers new directories.
export class StableFolderWatch {
  private pending = new Map<string, { signature: string; since: number }>();
  private known = new Map<string, string>();
  private stopped = false;
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    readonly root: string,
    private readonly report: (files: FolderMedia[], error: string | null) => void,
    private readonly settleMs = 2000,
  ) {}
  start() {
    this.timer = setInterval(() => {
      void this.poll().catch((error) => this.report([], String(error)));
    }, 1000);
    this.timer.unref();
    return this.poll();
  }
  async poll(now = Date.now()) {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const candidates = await scanFolder(this.root);
      for (const key of this.pending.keys()) if (!candidates.has(key)) this.pending.delete(key);
      for (const key of this.known.keys()) if (!candidates.has(key)) this.known.delete(key);
      for (const [path, item] of candidates) {
        if (this.stopped) return;
        if (this.known.get(path) === item.signature) continue;
        const previous = this.pending.get(path);
        if (!previous || previous.signature !== item.signature) {
          this.pending.set(path, { signature: item.signature, since: now });
          continue;
        }
        if (now - previous.since < this.settleMs) continue;
        const absolute = join(this.root, path);
        const within = relative(await realpath(this.root), await realpath(absolute));
        if (within.startsWith("..") || isAbsolute(within)) continue;
        const before = await lstat(absolute);
        if (!before.isFile() || before.isSymbolicLink()) continue;
        const bytes = await readFile(absolute),
          after = await lstat(absolute);
        if (
          after.size !== item.size ||
          after.mtimeMs !== item.modified ||
          after.ctimeMs !== before.ctimeMs
        )
          continue;
        if (this.stopped) return;
        this.known.set(path, item.signature);
        this.pending.delete(path);
        this.report(
          [
            {
              path,
              bytes,
              modified: item.modified,
              role: mediaRole(path),
              shortAudioFallback: mediaRole(path, 0) !== mediaRole(path, 60),
            },
          ],
          null,
        );
      }
    } finally {
      this.running = false;
    }
  }
  close() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
