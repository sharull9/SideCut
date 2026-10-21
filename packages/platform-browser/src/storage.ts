import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";

export interface LocalResource {
  file: File;
  state: "available" | "unsupported";
  detail: string;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Browser storage request failed."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Browser storage transaction was aborted."));
    transaction.onerror = () => {
      /* onabort reports the final failure. */
    };
  });
  void promise.catch(() => {});
  return promise;
}

export class BrowserProjectStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<BrowserProjectStore> {
    const open = indexedDB.open("sidecut", 1);
    open.onupgradeneeded = () => {
      for (const name of ["projects", "preferences", "resources"])
        if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name);
    };
    const database = await request(open);
    database.onversionchange = () => database.close();
    return new BrowserProjectStore(database);
  }

  async ensureCurrent(create: () => ProjectFile): Promise<ProjectFile> {
    const transaction = this.database.transaction(["projects", "preferences"], "readwrite");
    const done = completed(transaction);
    // Register a rejection handler immediately so a failed request cannot leave an unhandled abort.
    void done.catch(() => {});
    try {
      const preferences = transaction.objectStore("preferences");
      const projects = transaction.objectStore("projects");
      const current: unknown = await request(preferences.get("current"));
      if (typeof current === "string") {
        const saved: unknown = await request(projects.get(current));
        if (typeof saved !== "string")
          throw new Error(
            "The saved project is unavailable. Open a downloaded .tandem file to recover it.",
          );
        const file = decodeProjectFile(JSON.parse(saved));
        await done;
        return file;
      }
      const file = create();
      projects.put(encodeProjectFile(file), file.project.id);
      preferences.put(file.project.id, "current");
      await done;
      return file;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already complete or aborted. */
      }
      throw error;
    }
  }

  async load(id: string): Promise<ProjectFile | null> {
    const transaction = this.database.transaction("projects", "readonly");
    const done = completed(transaction);
    const value: unknown = await request(transaction.objectStore("projects").get(id));
    await done;
    if (value === undefined) return null;
    if (typeof value !== "string")
      throw new Error("The saved project has an invalid storage format.");
    return decodeProjectFile(JSON.parse(value));
  }

  async save(file: ProjectFile): Promise<void> {
    const json = encodeProjectFile(file);
    const transaction = this.database.transaction("projects", "readwrite");
    const done = completed(transaction);
    try {
      transaction.objectStore("projects").put(json, file.project.id);
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  async importProject(file: ProjectFile): Promise<void> {
    const json = encodeProjectFile(file);
    const transaction = this.database.transaction(["projects", "preferences"], "readwrite");
    const done = completed(transaction);
    void done.catch(() => {});
    try {
      const projects = transaction.objectStore("projects");
      const existing: unknown = await request(projects.get(file.project.id));
      if (existing !== undefined && existing !== json)
        throw new Error(
          "A different saved copy has this project ID. Open its saved copy or use another browser profile; the local copy was not overwritten.",
        );
      if (existing === undefined) projects.put(json, file.project.id);
      transaction.objectStore("preferences").put(file.project.id, "current");
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already complete or aborted. */
      }
      throw error;
    }
  }

  async resource(projectID: string, mediaID: string): Promise<LocalResource | null> {
    const transaction = this.database.transaction("resources", "readonly");
    const done = completed(transaction);
    const value: unknown = await request(
      transaction.objectStore("resources").get([projectID, mediaID]),
    );
    await done;
    if (
      !value ||
      typeof value !== "object" ||
      !("file" in value) ||
      !(value.file instanceof File) ||
      !("state" in value) ||
      !("detail" in value) ||
      typeof value.detail !== "string" ||
      (value.state !== "available" && value.state !== "unsupported")
    )
      return null;
    return { file: value.file, state: value.state, detail: value.detail };
  }

  async putResource(projectID: string, mediaID: string, value: LocalResource): Promise<void> {
    const transaction = this.database.transaction("resources", "readwrite");
    const done = completed(transaction);
    try {
      transaction.objectStore("resources").put(value, [projectID, mediaID]);
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  close() {
    this.database.close();
  }
}
