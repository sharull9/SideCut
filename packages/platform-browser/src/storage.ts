import { replayJournal } from "@sidecut/core/coordinator";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import type { DurableStorage } from "./sqlite-client";
import { encodeStored, decodeStored } from "./storage-codec";
import { migrateLegacy, readLegacy } from "./legacy-storage";
import type { StorageRequest } from "@sidecut/contracts/storage";

export interface LocalResource {
  file: File;
  state: "available" | "unsupported";
  detail: string;
}
export function storedResource(value: unknown): LocalResource | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("file" in value) ||
    !("state" in value) ||
    !("detail" in value) ||
    typeof value.detail !== "string" ||
    (value.state !== "available" && value.state !== "unsupported")
  )
    return null;
  const file = value.file;
  if (file instanceof File) return { file, state: value.state, detail: value.detail };
  if (
    file &&
    typeof file === "object" &&
    "bytes" in file &&
    file.bytes instanceof ArrayBuffer &&
    "name" in file &&
    typeof file.name === "string" &&
    "type" in file &&
    typeof file.type === "string" &&
    "lastModified" in file &&
    typeof file.lastModified === "number" &&
    Number.isFinite(file.lastModified)
  )
    return {
      file: new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified }),
      state: value.state,
      detail: value.detail,
    };
  return null;
}

const decode = (value: string, id: string) => {
  const file = replayJournal(decodeProjectFile(JSON.parse(value)));
  if (file.project.id !== id) throw new Error("Saved project ID does not match.");
  return file;
};
const resourceKey = (project: string, media: string) => JSON.stringify([project, media]);

export class BrowserProjectStore {
  private readonly versions = new Map<string, string>();
  private constructor(private readonly database: DurableStorage) {}

  static async open() {
    const database = await migrateLegacy("sidecut-projects", async (storage) => {
      const legacy = await readLegacy("sidecut", [
        "projects",
        "preferences",
        "resources",
        "journals",
        "previous",
      ]);
      const writes: Extract<StorageRequest, { type: "commit" }>["writes"][number][] = [];
      if (!storage.native) {
        const ids = new Set(
          [...(legacy.projects ?? []), ...(legacy.previous ?? []), ...(legacy.journals ?? [])].map(
            (e) => e.key,
          ),
        );
        for (const id of ids) {
          if (typeof id !== "string") throw new Error("Invalid legacy project ID.");
          const current = legacy.projects?.find((e) => e.key === id)?.value;
          const previous = legacy.previous?.find((e) => e.key === id)?.value;
          const staged = legacy.journals?.find((e) => e.key === id)?.value;
          let next = current;
          if (
            staged &&
            typeof staged === "object" &&
            "previous" in staged &&
            "next" in staged &&
            (staged.previous === current || staged.next === current)
          ) {
            try {
              if (typeof staged.next !== "string") throw new Error("Invalid journal.");
              decode(staged.next, id);
              next = staged.next;
            } catch {
              /* Recover the valid current or previous snapshot below. */
            }
          }
          try {
            if (typeof next !== "string") throw new Error("Invalid snapshot.");
            decode(next, id);
          } catch {
            if (typeof previous !== "string")
              throw new Error("Legacy project is damaged and has no valid backup.");
            decode(previous, id);
            next = previous;
          }
          if (typeof next !== "string") throw new Error("Invalid project snapshot.");
          writes.push({ collection: "projects", key: id, value: next });
          if (typeof previous === "string") {
            try {
              decode(previous, id);
              writes.push({ collection: "previous", key: id, value: previous });
            } catch {
              /* An invalid backup must not prevent importing a valid current snapshot. */
            }
          }
        }
        const current = legacy.preferences?.find((e) => e.key === "current")?.value;
        if (current !== undefined) {
          if (typeof current !== "string" || !ids.has(current))
            throw new Error("The legacy current project is missing.");
          writes.push({ collection: "preferences", key: "current", value: current });
        }
      }
      for (const { key, value } of legacy.resources ?? []) {
        const resource = storedResource(value);
        if (
          !Array.isArray(key) ||
          key.length !== 2 ||
          typeof key[0] !== "string" ||
          typeof key[1] !== "string" ||
          !resource
        )
          throw new Error("Invalid legacy media resource.");
        writes.push({
          collection: "resources",
          key: resourceKey(key[0], key[1]),
          value: await encodeStored(resource, storage),
        });
      }
      return writes;
    });
    return new BrowserProjectStore(database);
  }

  private async value(collection: "projects" | "previous" | "preferences", key: string) {
    return (await this.database.request({ type: "read", collection, key }))[0]?.value ?? null;
  }
  async ensureCurrent(create: () => ProjectFile): Promise<ProjectFile> {
    const current = await this.value("preferences", "current");
    if (current !== null) {
      const file = await this.load(current);
      if (!file)
        throw new Error(
          "The saved project is unavailable. Open a downloaded .tandem file to recover it.",
        );
      return file;
    }
    const file = create(),
      json = encodeProjectFile(file);
    try {
      await this.database.request({
        type: "commit",
        checks: [
          { collection: "preferences", key: "current", value: null },
          { collection: "projects", key: file.project.id, value: null },
        ],
        writes: [
          { collection: "projects", key: file.project.id, value: json },
          { collection: "preferences", key: "current", value: file.project.id },
        ],
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Save conflict"))
        return this.ensureCurrent(create);
      throw error;
    }
    this.versions.set(file.project.id, json);
    return file;
  }
  async load(id: string): Promise<ProjectFile | null> {
    const current = await this.value("projects", id);
    if (current === null) return null;
    try {
      const file = decode(current, id);
      this.versions.set(id, current);
      return file;
    } catch {
      const previous = await this.value("previous", id);
      if (previous === null)
        throw new Error("Saved project is damaged and no backup is available.");
      const file = decode(previous, id);
      await this.database.request({
        type: "commit",
        checks: [{ collection: "projects", key: id, value: current }],
        writes: [{ collection: "projects", key: id, value: previous }],
      });
      this.versions.set(id, previous);
      return {
        ...file,
        sidecutRecovery:
          "Recovered the previous valid project version. The latest stored snapshot was damaged.",
      };
    }
  }
  async save(file: ProjectFile) {
    replayJournal(file);
    const { sidecutRecovery: _recovery, ...clean } = file;
    const json = encodeProjectFile(clean),
      id = file.project.id;
    const expected = this.versions.get(id) ?? null;
    await this.database.request({
      type: "commit",
      checks: [{ collection: "projects", key: id, value: expected }],
      writes: [
        ...(expected === null
          ? []
          : [{ collection: "previous" as const, key: id, value: expected }]),
        { collection: "projects", key: id, value: json },
      ],
    });
    this.versions.set(id, json);
  }
  async importProject(file: ProjectFile) {
    replayJournal(file);
    const json = encodeProjectFile(file),
      id = file.project.id;
    const existing = await this.value("projects", id);
    if (existing !== null && existing !== json)
      throw new Error(
        "A different saved copy has this project ID. The local copy was not overwritten.",
      );
    await this.database.request({
      type: "commit",
      checks: [{ collection: "projects", key: id, value: existing }],
      writes: [
        { collection: "projects", key: id, value: json },
        { collection: "preferences", key: "current", value: id },
      ],
    });
  }
  async resource(projectID: string, mediaID: string): Promise<LocalResource | null> {
    const row = (
      await this.database.request({
        type: "read",
        collection: "resources",
        key: resourceKey(projectID, mediaID),
      })
    )[0];
    if (!row) return null;
    return this.decodeResource(row.value);
  }
  private async decodeResource(value: string): Promise<LocalResource | null> {
    let resource: LocalResource | null;
    try {
      resource = storedResource(await decodeStored(value, this.database));
    } catch (error) {
      if (error instanceof Error && error.message.includes("Stored media file is missing."))
        return null;
      throw error;
    }
    if (!resource) throw new Error("Stored resource has an invalid format.");
    return resource;
  }
  async putResource(projectID: string, mediaID: string, value: LocalResource) {
    await this.database.request({
      type: "commit",
      checks: [],
      writes: [
        {
          collection: "resources",
          key: resourceKey(projectID, mediaID),
          value: await encodeStored(value, this.database),
        },
      ],
    });
  }
  async resources(projectID: string) {
    const values: { key: string; resource: LocalResource }[] = [];
    for (const row of await this.database.request({ type: "read", collection: "resources" })) {
      const key: unknown = JSON.parse(row.key);
      if (
        !Array.isArray(key) ||
        key.length !== 2 ||
        typeof key[0] !== "string" ||
        typeof key[1] !== "string"
      )
        throw new Error("Invalid stored media key.");
      if (key[0] !== projectID) continue;
      const resource = await this.decodeResource(row.value);
      if (resource === null) continue;
      values.push({ key: key[1], resource });
    }
    return values;
  }
  close() {
    /* The shared connection lives for the page, including library users. */
  }
}
