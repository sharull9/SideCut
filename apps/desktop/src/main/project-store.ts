import { open, readFile, unlink, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import { replayJournal, ProjectCoordinator } from "@sidecut/core/coordinator";
import { openSQLite } from "./sqlite-storage.ts";

const read = async (path: string) =>
  readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const validate = (json: string) => replayJournal(decodeProjectFile(JSON.parse(json)));
const lockedMessage =
  "Project is locked by another host. Close it first. An unreadable lock requires manual recovery after checking that no raE.E process is running.";
function ownerExited(json: string) {
  let owner: unknown;
  try {
    owner = JSON.parse(json);
  } catch {
    return false;
  }
  if (
    !owner ||
    typeof owner !== "object" ||
    !("pid" in owner) ||
    !("token" in owner) ||
    typeof owner.pid !== "number" ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.token !== "string" ||
    !owner.token
  )
    return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

export class NativeProjectStore {
  private expected: string | null = null;
  private token = randomUUID();
  private locked = false;
  private connection: ReturnType<typeof openSQLite> | null = null;
  readonly databasePath: string;
  private portableOriginal: string | null = null;
  private portableBaseline: string | undefined;
  constructor(
    readonly path: string,
    private readonly options: { databasePath?: string; portable?: boolean } = {},
  ) {
    this.databasePath = options.databasePath ?? join(dirname(path), "sidecut.sqlite");
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
    // SQLite's OS lock serializes stale-file reclamation and is released even on a crash.
    const guard = new DatabaseSync(`${this.path}.lock.sqlite`);
    try {
      try {
        guard.exec("BEGIN IMMEDIATE");
      } catch {
        throw new Error(lockedMessage);
      }
      const previous = await read(`${this.path}.lock`);
      if (previous !== null) {
        if (!ownerExited(previous)) throw new Error(lockedMessage);
        await unlink(`${this.path}.lock`);
      }
      const lock = await open(`${this.path}.lock`, "wx");
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, token: this.token }));
        await lock.sync();
        this.locked = true;
      } finally {
        await lock.close();
      }
      guard.exec("COMMIT");
    } finally {
      guard.close();
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
    if (this.options.portable) {
      this.portableOriginal = await read(this.path);
      this.portableBaseline = encodeProjectFile(new ProjectCoordinator(file).projectFile());
    }
    return file;
  }

  private async publishPortable(json: string) {
    if (!this.options.portable || json === this.portableBaseline) return;
    if ((await read(this.path)) !== this.portableOriginal)
      throw new Error("Project file changed outside raE.E. No file was replaced.");
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(json, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      if ((await read(this.path)) !== this.portableOriginal)
        throw new Error("Project file changed outside raE.E. No file was replaced.");
      await rename(temporary, this.path);
      this.portableOriginal = json;
      this.portableBaseline = json;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async save(file: ProjectFile) {
    const json = encodeProjectFile(file);
    validate(json);
    const current = this.current();
    if (current !== this.expected)
      throw new Error(
        "Project changed outside raE.E. Reload the disk version or recover the backup.",
      );
    if (current === json) {
      await this.publishPortable(json);
      return;
    }
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
    await this.publishPortable(json);
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
  cameraPictureDelay(value?: number) {
    if (value !== undefined) {
      if (!Number.isFinite(value) || Math.abs(value) > 1)
        throw new Error("Picture delay must be within one second.");
      this.repository.request({
        type: "commit",
        checks: [],
        writes: [{ collection: "preferences", key: "cameraPictureDelay", value: String(value) }],
      });
    }
    const saved = Number(
      this.repository.request({
        type: "read",
        collection: "preferences",
        key: "cameraPictureDelay",
      })[0]?.value ?? 0,
    );
    if (!Number.isFinite(saved) || Math.abs(saved) > 1)
      throw new Error("Invalid saved camera delay.");
    return saved;
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
