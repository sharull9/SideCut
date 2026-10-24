import { open, readFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import { replayJournal } from "@sidecut/core/coordinator";

const read = async (path: string) =>
  readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const validate = (json: string) => replayJournal(decodeProjectFile(JSON.parse(json)));

export class NativeProjectStore {
  private expected: string | null = null;
  private token = randomUUID();
  private locked = false;
  constructor(readonly path: string) {}

  async acquire() {
    await mkdir(dirname(this.path), { recursive: true });
    const lock = await open(`${this.path}.lock`, "wx").catch(() => {
      throw new Error(
        "Project is locked by another host. Close it first. If it crashed, remove the .lock file after checking that no SideCut process is running.",
      );
    });
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, token: this.token }));
      await lock.sync();
      this.locked = true;
    } finally {
      await lock.close();
    }
  }

  async load(create: () => ProjectFile, backup = false): Promise<ProjectFile> {
    if (!this.locked) throw new Error("Project lock is not held.");
    const current = await read(this.path);
    const json = backup ? await read(`${this.path}.bak`) : current;
    if (backup && !json) throw new Error("No project backup is available.");
    const file = json === null ? create() : validate(json);
    this.expected = current;
    return file;
  }

  async save(file: ProjectFile) {
    if (!this.locked) throw new Error("Project lock is not held.");
    const json = encodeProjectFile(file);
    validate(json);
    const current = await read(this.path);
    if (current !== this.expected)
      throw new Error(
        "Project changed outside SideCut. Download your edits, then reload the disk version or recover the backup.",
      );
    if (current === json) return;
    // Preserve only validated backups, including when recovering a damaged current file.
    if (current !== null) {
      let valid = false;
      try {
        validate(current);
        valid = true;
      } catch {
        /* Keep the last valid backup. */
      }
      if (valid) await this.atomic(`${this.path}.bak`, current);
    }
    // Recheck after writing the backup so an external edit cannot be silently overwritten.
    if ((await read(this.path)) !== this.expected)
      throw new Error("Project changed during save. Reload the disk version.");
    await this.atomic(this.path, json);
    this.expected = json;
  }

  private async atomic(path: string, json: string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx");
      try {
        await handle.writeFile(json);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async close() {
    if (!this.locked) return;
    const lock = JSON.parse((await read(`${this.path}.lock`)) ?? "null") as {
      token?: string;
    } | null;
    if (lock?.token !== this.token) throw new Error("Project lock ownership changed.");
    await unlink(`${this.path}.lock`);
    this.locked = false;
  }
}
