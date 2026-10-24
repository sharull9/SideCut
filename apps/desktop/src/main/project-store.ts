import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import { replayJournal } from "@sidecut/core/coordinator";
import { openSQLite } from "./sqlite-storage.ts";

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
  private connection: ReturnType<typeof openSQLite> | null = null;
  readonly databasePath: string;
  constructor(readonly path: string) {
    this.databasePath = join(dirname(path), "sidecut.sqlite");
  }

  private get repository() {
    if (!this.locked || !this.connection) throw new Error("Project lock is not held.");
    return this.connection.repository;
  }
  private current(backup = false) {
    return (
      this.repository.request({
        type: "read",
        collection: backup ? "previous" : "projects",
        key: "host",
      })[0]?.value ?? null
    );
  }

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
    if (!this.connection) this.connection = openSQLite(this.databasePath);
    const repository = this.repository;
    if (
      !repository.request({ type: "read", collection: "migrations", key: "native-project" }).length
    ) {
      const legacy = await read(this.path);
      let previous = await read(`${this.path}.bak`);
      let current = legacy;
      if (current === null && previous !== null)
        current = encodeProjectFile({
          ...validate(previous),
          sidecutRecovery: "Recovered the previous valid project during SQLite migration.",
        });
      if (current !== null) {
        try {
          validate(current);
        } catch (error) {
          if (!previous) throw error;
          validate(previous);
          current = encodeProjectFile({
            ...validate(previous),
            sidecutRecovery: "Recovered the previous valid project during SQLite migration.",
          });
        }
      }
      if (previous !== null) {
        try {
          validate(previous);
        } catch {
          previous = null;
        }
      }
      repository.request({
        type: "commit",
        checks: [{ collection: "migrations", key: "native-project", value: null }],
        writes: [
          ...(current === null
            ? []
            : [{ collection: "projects" as const, key: "host", value: current }]),
          ...(previous === null
            ? []
            : [{ collection: "previous" as const, key: "host", value: previous }]),
          { collection: "migrations", key: "native-project", value: "1" },
        ],
      });
    }
    const current = this.current(),
      json = backup ? this.current(true) : current;
    if (backup && !json) throw new Error("No project backup is available.");
    const file = json === null ? create() : validate(json);
    this.expected = current;
    return file;
  }

  async save(file: ProjectFile) {
    const json = encodeProjectFile(file);
    validate(json);
    const current = this.current();
    if (current !== this.expected)
      throw new Error(
        "Project changed outside SideCut. Reload the disk version or recover the backup.",
      );
    if (current === json) return;
    let valid = false;
    if (current !== null) {
      try {
        validate(current);
        valid = true;
      } catch {
        /* Keep last valid backup. */
      }
    }
    this.repository.request({
      type: "commit",
      checks: [{ collection: "projects", key: "host", value: this.expected }],
      writes: [
        ...(valid ? [{ collection: "previous" as const, key: "host", value: current }] : []),
        { collection: "projects", key: "host", value: json },
      ],
    });
    this.expected = json;
  }

  reviewedRevision(projectID: string) {
    const value = this.repository.request({
      type: "read",
      collection: "preferences",
      key: `reviewed:${projectID}`,
    })[0]?.value;
    if (value == null) return 0;
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new Error("Invalid saved review baseline.");
    return revision;
  }
  markReviewed(projectID: string, revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new Error("Invalid review revision.");
    this.repository.request({
      type: "commit",
      checks: [],
      writes: [
        { collection: "preferences", key: `reviewed:${projectID}`, value: String(revision) },
      ],
    });
  }

  async close() {
    if (!this.locked) return;
    const lock: unknown = JSON.parse((await read(`${this.path}.lock`)) ?? "null");
    if (!lock || typeof lock !== "object" || !("token" in lock) || lock.token !== this.token)
      throw new Error("Project lock ownership changed.");
    this.connection?.database.close();
    this.connection = null;
    await unlink(`${this.path}.lock`);
    this.locked = false;
  }
}
