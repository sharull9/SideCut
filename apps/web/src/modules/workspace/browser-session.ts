import { ProjectCoordinator } from "@sidecut/core/coordinator";
import type { SessionSnapshot, CommitResult } from "@sidecut/core/coordinator";
import {
  decodeProjectFile,
  encodeProjectFile,
  inspectProjectFile,
} from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import { BrowserProjectStore } from "@sidecut/platform-browser/storage";
import { acquireProjectWriter } from "@sidecut/platform-browser/writer-lock";
import { SaveQueue } from "@sidecut/platform-browser/save-queue";
import { probeLocalFile, mediaIdentity } from "@sidecut/platform-browser/media";

export interface MediaAvailability {
  state: "available" | "missing" | "unsupported";
  detail: string;
}
export interface BrowserSnapshot extends SessionSnapshot {
  warnings: readonly string[];
  saveState: "loading" | "saving" | "saved" | "error" | "read-only";
  readOnly: boolean;
  busy: boolean;
  error: string | null;
  unsupportedJSON: string | null;
  mediaAvailability: Readonly<Record<string, MediaAvailability>>;
}

function standardProject(id: string): ProjectFile {
  return decodeProjectFile({
    revision: 0,
    project: {
      id,
      name: "Untitled sequence",
      videoTracks: ["Screen", "Camera", "B-roll", "Graphics", "Text"].map((name, index) => ({
        id: `trk_video_${index}`,
        kind: "video",
        name,
        rippleMode: index < 2 ? "cut" : "follow",
      })),
      audioTracks: ["Voice", "Music", "SFX"].map((name, index) => ({
        id: `trk_audio_${index}`,
        kind: "audio",
        name,
        rippleMode: index === 0 ? "cut" : "follow",
      })),
    },
  });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
function coordinatorState(coordinator: ProjectCoordinator): SessionSnapshot {
  const state = coordinator.getSnapshot();
  return {
    project: state.project,
    revision: state.revision,
    undoLabel: state.undoLabel,
    redoLabel: state.redoLabel,
    lastChange: state.lastChange,
  };
}

export class BrowserProjectSession {
  private archivedRaw: string | null = null;
  private envelope = standardProject("prj_loading");
  private coordinator = new ProjectCoordinator(this.envelope);
  private state: BrowserSnapshot = {
    warnings: [],
    ...this.coordinator.getSnapshot(),
    saveState: "loading",
    readOnly: true,
    busy: false,
    error: null,
    unsupportedJSON: null,
    mediaAvailability: {},
  };
  private store: BrowserProjectStore | null = null;
  private release: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private queue: SaveQueue | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private exportController: AbortController | null = null;

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(): Promise<void> {
    const epoch = ++this.epoch;
    let store: BrowserProjectStore | null = null;
    let release: (() => void) | null = null;
    this.archivedRaw = null;
    this.update({
      saveState: "loading",
      readOnly: true,
      busy: false,
      error: null,
      unsupportedJSON: null,
    });
    try {
      store = await BrowserProjectStore.open();
      if (epoch !== this.epoch) {
        store.close();
        return;
      }
      const file = await store.ensureCurrent(() => standardProject(`prj_${crypto.randomUUID()}`));
      if (epoch !== this.epoch) {
        store.close();
        return;
      }
      release = await acquireProjectWriter(file.project.id);
      const loaded = (await store.load(file.project.id)) ?? file;
      const latest = file.sidecutRecovery
        ? { ...loaded, sidecutRecovery: file.sidecutRecovery }
        : loaded;
      if (epoch !== this.epoch) {
        release?.();
        store.close();
        return;
      }
      this.store = store;
      this.release = release;
      if (typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel("sidecut.project.changes");
        this.channel.onmessage = (event) => {
          if (event.data === this.state.project.id && this.state.readOnly && !this.state.busy)
            void this.refreshReadOnly().catch((error) => this.update({ error: message(error) }));
        };
      }
      this.attach(latest, release === null);
      await this.refreshMedia();
    } catch (error) {
      release?.();
      store?.close();
      if (epoch === this.epoch) {
        this.store = null;
        this.release = null;
        this.update({ saveState: "error", readOnly: true, error: message(error) });
      }
    }
  }

  private attach(file: ProjectFile, readOnly: boolean) {
    this.unsubscribe?.();
    this.envelope = file;
    this.coordinator = new ProjectCoordinator(file);
    const coordinator = this.coordinator;
    const epoch = this.epoch;
    const store = this.store;
    if (!store) throw new Error("Browser storage is closed.");
    this.queue = new SaveQueue(
      async (snapshot) => {
        await store.save(snapshot);
        this.channel?.postMessage(snapshot.project.id);
      },
      (saveState, error) => {
        if (this.epoch !== epoch || this.coordinator !== coordinator) return;
        this.update({
          saveState,
          error: error ? `Could not save: ${message(error)}. Download a copy or retry.` : null,
        });
      },
    );
    this.unsubscribe = this.coordinator.subscribe(() => {
      this.update(coordinatorState(this.coordinator));
      this.queue?.enqueue(this.projectFile());
      void this.refreshMedia().catch((error) => this.update({ error: message(error) }));
    });
    this.update({
      ...coordinatorState(this.coordinator),
      readOnly,
      saveState: readOnly ? "read-only" : "saved",
      error: null,
      mediaAvailability: {},
      warnings: typeof file.sidecutRecovery === "string" ? [file.sidecutRecovery] : [],
    });
  }

  private update(patch: Partial<BrowserSnapshot>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }

  private assertWritable() {
    if (this.state.readOnly || this.state.saveState === "loading")
      throw new Error("This project is read-only. Enable editing after the other tab closes.");
    if (this.state.busy) throw new Error("Wait for the current file operation to finish.");
  }

  private assertOpen(epoch: number) {
    if (epoch !== this.epoch || !this.store) throw new Error("The project session was closed.");
  }

  apply(input: unknown): CommitResult {
    this.assertWritable();
    const result = this.coordinator.apply(input);
    this.update({ warnings: result.warnings });
    return result;
  }
  undo(): CommitResult | null {
    this.assertWritable();
    this.update({ warnings: [] });
    return this.coordinator.undo();
  }
  redo(): CommitResult | null {
    this.assertWritable();
    this.update({ warnings: [] });
    return this.coordinator.redo();
  }
  projectFile(): ProjectFile {
    return this.coordinator.projectFile();
  }

  async resource(mediaID: string) {
    return this.store?.resource(this.state.project.id, mediaID) ?? null;
  }

  async exportWebM(signal: AbortSignal, onProgress: (progress: number) => void) {
    if (!this.store || this.state.busy || this.state.saveState === "loading")
      throw new Error("Wait for the current project operation to finish.");
    const store = this.store,
      project = this.state.project,
      epoch = this.epoch,
      controller = new AbortController();
    this.exportController = controller;
    this.update({ busy: true });
    try {
      const { renderWebM } = await import("@sidecut/platform-browser/export");
      return await renderWebM(
        project,
        (id) => store.resource(project.id, id),
        AbortSignal.any([signal, controller.signal]),
        onProgress,
      );
    } finally {
      if (this.exportController === controller) this.exportController = null;
      if (this.epoch === epoch) this.update({ busy: false });
    }
  }

  async retrySave() {
    if (!this.store) {
      await this.start();
      return;
    }
    this.assertWritable();
    this.queue?.enqueue(this.projectFile());
    await this.queue?.flush();
  }

  async enableEditing() {
    if (this.archivedRaw)
      throw new Error("This imported project uses unsupported data and must stay read-only.");
    if (!this.store || !this.state.readOnly || this.state.busy) return;
    const epoch = this.epoch;
    this.update({ busy: true, error: null });
    let release: (() => void) | null = null;
    try {
      release = await acquireProjectWriter(this.state.project.id);
      this.assertOpen(epoch);
      if (!release)
        throw new Error("Another tab is still editing this project. Close it and try again.");
      const latest = await this.store.load(this.state.project.id);
      this.assertOpen(epoch);
      if (!latest) throw new Error("The saved project was not found.");
      this.release = release;
      this.attach(latest, false);
      await this.refreshMedia();
    } catch (error) {
      release?.();
      if (epoch === this.epoch) this.update({ error: message(error) });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  private async refreshReadOnly() {
    const epoch = this.epoch;
    const id = this.state.project.id;
    const latest = await this.store?.load(id);
    if (
      epoch === this.epoch &&
      this.store &&
      latest &&
      this.state.readOnly &&
      this.state.project.id === id &&
      !this.state.busy
    ) {
      this.attach(latest, true);
      await this.refreshMedia();
    }
  }

  async openProject(file: File) {
    if (!this.store || this.state.busy || this.state.saveState === "loading")
      throw new Error("Wait for browser storage to finish opening.");
    const epoch = this.epoch;
    this.update({ busy: true, error: null });
    let candidateRelease: (() => void) | null = null;
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error(
          "Project JSON exceeds the 20 MB import limit. Select a .tandem project, not a media file.",
        );
      const original = await file.text();
      const inspected = inspectProjectFile(JSON.parse(original));
      if (!inspected.editable) {
        if (!this.state.readOnly) await this.queue?.flush();
        this.assertOpen(epoch);
        this.release?.();
        this.release = null;
        this.attach(
          decodeProjectFile({ revision: 0, project: { id: "prj_unsupported", name: file.name } }),
          true,
        );
        this.archivedRaw = original;
        this.update({ warnings: [inspected.reason], unsupportedJSON: original, error: null });
        return;
      }
      const candidate = inspected.file;
      this.assertOpen(epoch);
      new ProjectCoordinator(candidate).getSnapshot();
      if (!this.state.readOnly) await this.queue?.flush();
      this.assertOpen(epoch);
      const same = candidate.project.id === this.state.project.id;
      if (!same) candidateRelease = await acquireProjectWriter(candidate.project.id);
      this.assertOpen(epoch);
      await this.store.importProject(candidate);
      const latest = (await this.store.load(candidate.project.id)) ?? candidate;
      this.assertOpen(epoch);
      if (!same) {
        this.release?.();
        this.release = candidateRelease;
      }
      this.archivedRaw = null;
      this.update({ unsupportedJSON: null });
      this.attach(latest, this.release === null);
      candidateRelease = null;
      await this.refreshMedia();
    } catch (error) {
      candidateRelease?.();
      throw error;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  downloadProject() {
    const json = this.archivedRaw ?? encodeProjectFile(this.projectFile());
    // Run the same full validator used for editing before exporting a project.
    const validated = this.archivedRaw
      ? null
      : new ProjectCoordinator(decodeProjectFile(JSON.parse(json))).getSnapshot();
    if (validated?.project.id === "prj_loading")
      throw new Error("Wait for a project to open before downloading it.");
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    // Control characters and filesystem separators cannot be used in a download filename.
    // eslint-disable-next-line no-control-regex
    anchor.download = `${this.state.project.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "Untitled"}.tandem`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async importFiles(files: readonly File[]) {
    this.assertWritable();
    if (!this.store || !files.length) return;
    const epoch = this.epoch;
    this.update({ busy: true, error: null });
    try {
      const known = new Map(
        this.state.project.media.map((item) => [
          mediaIdentity(item.path, item.fingerprint),
          item.id,
        ]),
      );
      const commands = [];
      for (const file of files) {
        const { item, resource } = await probeLocalFile(file);
        this.assertOpen(epoch);
        const key = mediaIdentity(item.path, item.fingerprint);
        const existingID = known.get(key);
        if (existingID) {
          await this.store.putResource(this.state.project.id, existingID, resource);
          continue;
        }
        await this.store.putResource(this.state.project.id, item.id, resource);
        commands.push({ addMedia: { item } });
        known.set(key, item.id);
      }
      this.assertOpen(epoch);
      if (commands.length)
        this.coordinator.apply({
          label: `Import ${commands.length} media file${commands.length === 1 ? "" : "s"}`,
          expectedRevision: this.state.revision,
          commands,
        });
      await this.queue?.flush();
      await this.refreshMedia();
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  private async refreshMedia() {
    const epoch = this.epoch;
    const { project, revision } = this.state;
    const availability: Record<string, MediaAvailability> = {};
    await Promise.all(
      project.media.map(async (item) => {
        const resource = await this.store?.resource(project.id, item.id);
        availability[item.id] = resource
          ? { state: resource.state, detail: resource.detail }
          : {
              state: "missing",
              detail:
                "Source is not stored in this browser. Project downloads contain references only. Relinking and portable archives are planned.",
            };
      }),
    );
    if (
      this.epoch === epoch &&
      this.state.project.id === project.id &&
      this.state.revision === revision
    )
      this.update({ mediaAvailability: availability });
  }

  async close() {
    this.exportController?.abort();
    ++this.epoch;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const store = this.store;
    const release = this.release;
    const queue = this.queue;
    this.store = null;
    this.release = null;
    this.channel?.close();
    this.channel = null;
    this.update({ readOnly: true });
    try {
      await queue?.flush();
    } catch {
      /* The last successfully committed snapshot remains intact. */
    }
    release?.();
    store?.close();
  }
}
