import { replayJournal } from "@sidecut/core/coordinator";
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
  private readonly versions = new Map<string, string>();

  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<BrowserProjectStore> {
    const open = indexedDB.open("sidecut", 2);
    open.onupgradeneeded = () => {
      for (const name of ["projects", "preferences", "resources", "journals", "previous"])
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
        await done;
        const file = await this.load(current);
        if (!file)
          throw new Error(
            "The saved project is unavailable. Open a downloaded .tandem file to recover it.",
          );
        return file;
      }
      const file = create();
      projects.put(encodeProjectFile(file), file.project.id);
      preferences.put(file.project.id, "current");
      await done;
      this.versions.set(file.project.id, encodeProjectFile(file));
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
    const transaction = this.database.transaction(["projects", "journals", "previous"], "readonly");
    const done = completed(transaction);
    const [current, staged, previous] = await Promise.all([
      request(transaction.objectStore("projects").get(id)),
      request(transaction.objectStore("journals").get(id)),
      request(transaction.objectStore("previous").get(id)),
    ]);
    await done;
    const decode = (value: unknown) => {
      if (typeof value !== "string")
        throw new Error("Saved project has an invalid storage format.");
      const file = replayJournal(decodeProjectFile(JSON.parse(value)));
      if (file.project.id !== id) throw new Error("Saved project ID does not match.");
      return file;
    };
    if (current === undefined && staged === undefined && previous === undefined) return null;
    let file: ProjectFile;
    let recovery: string | null = null;
    try {
      if (
        staged &&
        typeof staged === "object" &&
        "previous" in staged &&
        "next" in staged &&
        (current === staged.previous || current === staged.next)
      ) {
        try {
          file = decode(staged.next);
          if (current !== staged.next)
            recovery = "Recovered the staged edit journal after an interrupted snapshot save.";
        } catch {
          file = decode(current);
          recovery = "An incomplete journal was ignored; the last valid snapshot was opened.";
        }
      } else file = decode(current);
    } catch {
      file = decode(previous);
      recovery =
        "Recovered the previous valid project version. The latest stored snapshot was damaged.";
    }
    if (recovery) {
      const repair = this.database.transaction(["projects", "journals", "previous"], "readwrite");
      const repaired = completed(repair);
      // Only repair the exact version inspected above; another writer may have saved meanwhile.
      const actual = await request(repair.objectStore("projects").get(id));
      if (actual !== current) {
        repair.abort();
        await repaired.catch(() => {});
        throw new Error("Save conflict during recovery. Reopen the project.");
      }
      try {
        decode(current);
        if (current !== encodeProjectFile(file)) repair.objectStore("previous").put(current, id);
      } catch {
        /* Keep the existing backup when the current snapshot is damaged. */
      }
      repair.objectStore("projects").put(encodeProjectFile(file), id);
      repair.objectStore("journals").delete(id);
      await repaired;
    }
    this.versions.set(id, recovery ? encodeProjectFile(file) : (current as string));
    return recovery ? { ...file, sidecutRecovery: recovery } : file;
  }

  async save(file: ProjectFile): Promise<void> {
    replayJournal(file);
    const { sidecutRecovery: _recovery, ...clean } = file;
    const json = encodeProjectFile(clean),
      id = file.project.id;
    const expected = this.versions.get(id);
    const stage = this.database.transaction(["projects", "journals"], "readwrite");
    const staged = completed(stage);
    try {
      const current = await request(stage.objectStore("projects").get(id));
      if (current !== expected && current !== json)
        throw new Error(
          "Save conflict: a different version is stored. Download your edits, then reopen the saved project.",
        );
      stage.objectStore("journals").put({ previous: current, next: json }, id);
      await staged;
    } catch (error) {
      try {
        stage.abort();
      } catch {}
      await staged.catch(() => {});
      throw error;
    }
    const transaction = this.database.transaction(
      ["projects", "previous", "journals"],
      "readwrite",
    );
    const done = completed(transaction);
    try {
      const projects = transaction.objectStore("projects");
      const current = await request(projects.get(id));
      if (current !== expected && current !== json)
        throw new Error(
          "Save conflict: the stored project changed during this save. Download your edits and reopen.",
        );
      if (current !== undefined && current !== json)
        transaction.objectStore("previous").put(current, id);
      projects.put(json, id);
      transaction.objectStore("journals").delete(id);
      await done;
      this.versions.set(id, json);
    } catch (error) {
      try {
        transaction.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async importProject(file: ProjectFile): Promise<void> {
    replayJournal(file);
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

  async resources(projectID: string): Promise<{ key: string; resource: LocalResource }[]> {
    const transaction = this.database.transaction("resources", "readonly");
    const done = completed(transaction);
    const store = transaction.objectStore("resources");
    const range = IDBKeyRange.bound([projectID], [projectID, []]);
    const [keys, values] = await Promise.all([
      request(store.getAllKeys(range)),
      request(store.getAll(range)),
    ]);
    await done;
    return keys.map((key, index) => ({
      key: String((key as string[])[1]),
      resource: values[index] as LocalResource,
    }));
  }

  close() {
    this.database.close();
  }
}
