import type { FolderMedia } from "@sidecut/contracts/desktop";
import { createArchive, openArchive, type ArchiveResource } from "@sidecut/core/archive";
import { importEDL, importFilmora, object } from "@sidecut/core/interchange";
import { HostCoordinator, nativeBridge } from "./host-coordinator";
import { parseCube } from "@sidecut/core/cube-lut";
import { validateProject } from "@sidecut/core/validation";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { QueryError } from "@sidecut/core/project-queries";
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
import { BrowserJobs } from "@sidecut/platform-browser/jobs";
import { ExportQueue } from "@sidecut/platform-browser/export-queue";
import { exportPresetPlan, type ExportPreset } from "@sidecut/core/export-presets";
import { projectDuration } from "@sidecut/core/render-plan";
import { probeLocalFile, mediaIdentity } from "@sidecut/platform-browser/media";
import { MediaAnalysis } from "./media-analysis";
import { assetUsePlan, assetUses, recordAssetUse } from "@sidecut/core/asset-use";
import { decodeAsset } from "@sidecut/contracts/assets";
import {
  makeSegment,
  insertableSegment,
  segmentPrefix,
  type SegmentField,
} from "@sidecut/core/segments";
import { SegmentLibrary, type SegmentEntry } from "@sidecut/platform-browser/segments";
import type { LibraryEntry } from "@sidecut/platform-browser/asset-library";

export interface MediaAvailability {
  state: "available" | "missing" | "unsupported";
  detail: string;
}
export interface HistoryEntry {
  id: string;
  kind: "edit" | "undo" | "redo";
  revision: number | null;
  label: string;
  author: string;
  date?: string;
}
export interface BrowserSnapshot extends SessionSnapshot {
  reviewPendingCount?: number;
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
function coordinatorState(coordinator: ProjectCoordinator | HostCoordinator): SessionSnapshot {
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
  readonly jobs = new BrowserJobs(2);
  readonly exports = new ExportQueue();
  queueExport(
    format: string | null = null,
    preset: ExportPreset | "wav" = "webm",
    range: { from: number; to: number } | null = null,
  ) {
    format = preset === "short" ? "portrait" : preset === "wav" ? null : format;
    const { project, revision } = this.state;
    const bounds = range ? { ...range } : null;
    if (
      bounds &&
      (!Number.isFinite(bounds.from) ||
        !Number.isFinite(bounds.to) ||
        bounds.from < 0 ||
        bounds.to <= bounds.from ||
        bounds.to > projectDuration(project).seconds)
    )
      throw new Error("Choose a non-empty export range inside the sequence.");
    const name = `${project.name.replace(/[\\/:*?"<>|]/g, "_") || "SideCut"}${format ? ` ${format}` : ""}${preset === "webm" ? "" : ` ${preset}`}${bounds ? ` ${bounds.from.toFixed(3)}-${bounds.to.toFixed(3)}s` : ""}.${preset === "wav" ? "wav" : "webm"}`;
    return this.exports.enqueue(
      name,
      async (signal, progress) => {
        if (this.state.project.id !== project.id || this.state.revision !== revision)
          throw new Error("Project changed after this export was queued. Queue it again.");
        if (preset === "wav") {
          if (!this.store || this.state.busy || this.state.saveState === "loading")
            throw new Error("Wait for the current project operation to finish.");
          const epoch = this.epoch;
          this.update({ busy: true });
          try {
            const { renderService } = await import("./service-render");
            return await this.jobs.run("export", "Export audio", 10, signal, async (jobSignal) => {
              const result = await renderService(
                this,
                "clip",
                {
                  start: bounds?.from ?? 0,
                  end: bounds?.to ?? projectDuration(project).seconds,
                  audioOnly: true,
                  format,
                },
                jobSignal,
              );
              if (!("data" in result) || typeof result.data !== "string")
                throw new Error("Audio export returned no data.");
              return new Blob([Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))], {
                type: "audio/wav",
              });
            });
          } finally {
            if (this.epoch === epoch) this.update({ busy: false });
          }
        }
        return this.exportWebM(signal, progress, format, preset, bounds);
      },
      preset,
    );
  }
  readonly analysis = new MediaAnalysis(this);
  private archivedRaw: string | null = null;
  private envelope = standardProject("prj_loading");
  private coordinator: ProjectCoordinator | HostCoordinator = new ProjectCoordinator(this.envelope);
  private hostGeneration = 0;
  private folderStop: (() => void) | null = null;
  private folderPending = Promise.resolve();
  readonly native = nativeBridge();
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
      if (this.native) {
        this.store = store;
        this.attachHost();
        this.folderStop = this.native.folderSubscribe((files, error) => {
          if (error) {
            this.update({ error });
            return;
          }
          const projectID = this.state.project.id;
          const generation = this.hostGeneration;
          this.folderPending = this.folderPending
            .then(async () => {
              if (this.state.busy)
                await new Promise<void>((resolve) => {
                  const stop = this.subscribe(() => {
                    if (
                      !this.state.busy ||
                      store !== this.store ||
                      generation !== this.hostGeneration
                    ) {
                      stop();
                      resolve();
                    }
                  });
                });
              if (
                store !== this.store ||
                projectID !== this.state.project.id ||
                generation !== this.hostGeneration
              )
                return;
              await this.importFolderMedia(files);
            })
            .catch((cause) => {
              if (store === this.store) this.update({ error: message(cause) });
            });
        });
        await this.refreshMedia();
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

  private attachHost() {
    if (!this.native) return;
    this.unsubscribe?.();
    if (this.coordinator instanceof HostCoordinator) this.coordinator.close();
    this.coordinator = new HostCoordinator(this.native, (value) => {
      this.update({
        saveState: value.saveState,
        error: value.error,
        reviewPendingCount: value.reviewPendingCount ?? 0,
      });
    });
    this.hostGeneration = this.coordinator.generation;
    this.unsubscribe = this.coordinator.subscribe(() => {
      if (
        this.coordinator instanceof HostCoordinator &&
        this.coordinator.generation !== this.hostGeneration
      ) {
        this.hostGeneration = this.coordinator.generation;
        ++this.epoch;
        this.exports.clear();
        this.jobs.cancelAll();
        this.analysis.reset();
        this.exportController?.abort();
        this.update({ busy: false, mediaAvailability: {}, unsupportedJSON: null });
      }
      this.update(coordinatorState(this.coordinator));
      void this.refreshMedia().catch((error) => this.update({ error: message(error) }));
    });
    this.update({ ...coordinatorState(this.coordinator), readOnly: false, busy: false });
  }

  async reloadNativeProject(backup = false) {
    if (!this.native || !(this.coordinator instanceof HostCoordinator)) return;
    this.coordinator.receive(await this.native.projectReload(backup));
  }

  private async importFolderMedia(files: FolderMedia[]) {
    if (!this.store || !this.native) return;
    this.assertWritable();
    const epoch = this.epoch;
    this.update({ busy: true });
    try {
      for (const entry of files) {
        const file = new File([new Uint8Array(entry.bytes)], entry.path.split("/").at(-1)!, {
          lastModified: entry.modified,
        });
        const idForJob = crypto.randomUUID();
        const encoded = new Uint8Array(await file.arrayBuffer());
        const probe = JSON.parse(
          new TextDecoder().decode(await this.native.nativeMedia(idForJob, "probe", encoded)),
        ) as {
          format?: { duration?: string };
          streams?: { codec_type?: string; width?: number; height?: number }[];
        };
        const { item, resource } = await probeLocalFile(file);
        const duration = Number(probe.format?.duration);
        if (Number.isFinite(duration) && duration > 0) item.duration = duration;
        const video = probe.streams?.find((stream) => stream.codec_type === "video");
        item.hasVideo = Boolean(video);
        item.hasAudio = Boolean(probe.streams?.some((stream) => stream.codec_type === "audio"));
        if (video?.width) item.width = video.width;
        if (video?.height) item.height = video.height;
        if (resource.state === "unsupported" && item.kind === "audio") {
          const wav = await this.native.nativeMedia(crypto.randomUUID(), "decode", encoded);
          resource.file = new File([new Uint8Array(wav)], `${file.name}.wav`, {
            type: "audio/wav",
          });
          resource.state = "available";
          resource.detail = "Decoded locally by FFmpeg";
        }
        this.assertOpen(epoch);
        const existing = this.state.project.media.find((media) => media.path === entry.path);
        item.path = entry.path;
        // Refresh a changed source in place so timeline references remain valid.
        const id = existing?.id ?? item.id;
        await this.store.putResource(this.state.project.id, id, resource);
        this.assertOpen(epoch);
        const { id: _id, ...fields } = item;
        const patch = {
          ...fields,
          role:
            entry.shortAudioFallback && item.duration !== undefined && item.duration < 10
              ? "sfx"
              : entry.role,
        };
        this.coordinator.apply({
          label: existing ? "Refresh folder media" : "Import folder media",
          expectedRevision: this.state.revision,
          commands: [
            existing
              ? { updateMedia: { mediaID: id, patch } }
              : { addMedia: { item: { ...patch, id } } },
          ],
        });
      }
      await this.native.projectFlush();
      await this.refreshMedia();
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  async watchFolder() {
    await this.native?.folderSelect();
  }

  private attach(file: ProjectFile, readOnly: boolean) {
    this.exports.clear();
    this.jobs.cancelAll();
    this.analysis.reset();
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
      warnings: [
        ...(typeof file.sidecutRecovery === "string" ? [file.sidecutRecovery] : []),
        ...validateProject(file.project)
          .filter((issue) => issue.severity === "warning")
          .map((issue) => issue.message),
      ],
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
  /** Changes made to this project, oldest first; falls back to undo steps when no journal exists. */
  history(): { entries: readonly HistoryEntry[]; complete: boolean } {
    const coordinator = this.coordinator;
    const journal = coordinator.journalEntries();
    if (journal && (journal.length > 0 || this.state.revision === 0))
      return {
        complete: true,
        entries: journal.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          revision: entry.result.revision,
          label: entry.result.label,
          author: entry.result.author,
          ...(entry.date ? { date: entry.date } : {}),
        })),
      };
    // Without a journal only the undo stack knows about earlier edits.
    const labels =
      coordinator instanceof HostCoordinator
        ? this.state.undoLabel
          ? [{ label: this.state.undoLabel, author: "user" }]
          : []
        : coordinator.history(50).undo.toReversed();
    return {
      complete: false,
      entries: labels.map((entry, index) => ({
        id: `undo:${index}`,
        kind: "edit" as const,
        revision: null,
        label: entry.label,
        author: entry.author,
      })),
    };
  }

  async resource(mediaID: string) {
    const stored = await this.store?.resource(this.state.project.id, mediaID);
    if (stored || !this.native?.projectResource || !this.store) return stored ?? null;
    const projectID = this.state.project.id;
    const item = this.state.project.media.find((media) => media.id === mediaID);
    if (!item) return null;
    try {
      const source = await this.native.projectResource(mediaID);
      if (!source) return null;
      const { resource } = await probeLocalFile(
        new File([new Uint8Array(source.bytes)], source.name),
      );
      if (this.state.project.id !== projectID) return null;
      await this.store.putResource(projectID, mediaID, resource);
      return resource;
    } catch {
      return null;
    }
  }

  async exportWebM(
    signal: AbortSignal,
    onProgress: (progress: number) => void,
    format: string | null = null,
    preset: ExportPreset = "webm",
    range: { from: number; to: number } | null = null,
  ) {
    if (!this.store || this.state.busy || this.state.saveState === "loading")
      throw new Error("Wait for the current project operation to finish.");
    const store = this.store,
      settings = exportPresetPlan(this.state.project, preset, format),
      project = settings.project,
      epoch = this.epoch,
      controller = new AbortController();
    this.exportController = controller;
    this.update({ busy: true });
    try {
      const { renderWebM } = await import("@sidecut/platform-browser/export");
      return await this.jobs.run(
        "export",
        "Export video",
        10,
        AbortSignal.any([signal, controller.signal]),
        async (jobSignal, progress) => {
          return renderWebM(
            project,
            (id) => store.resource(project.id, id),
            jobSignal,
            (value) => {
              progress(value);
              onProgress(value);
            },
            {
              fullResolution: true,
              bitrate: settings.videoBitrate,
              ...(range ? { start: range.from, end: range.to } : {}),
            },
          );
        },
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
    if (this.native) {
      await this.native.projectFlush();
      return;
    }
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

  async openFilmoraFolder(files: readonly File[]) {
    if (files.length > 10000) throw new Error("Filmora folder exceeds 10000 entries.");
    const selected = files.filter((file) =>
      /(?:^|\/)(?:project_info\.json|timeline\.wesproj|extra\.json)$/.test(
        file.webkitRelativePath || file.name,
      ),
    );
    if (selected.reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024)
      throw new Error("Filmora folder metadata exceeds 20 MiB.");
    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const file of selected) {
      const path = file.webkitRelativePath || file.name;
      if (Object.hasOwn(entries, path)) throw new Error("Duplicate Filmora folder entry.");
      entries[path] = new Uint8Array(await file.arrayBuffer());
    }
    const imported = importFilmora(entries);
    await this.openProject(
      new File([encodeProjectFile(imported.file)], "filmora.tandem", { type: "application/json" }),
    );
  }

  async openProject(file: File) {
    if (!this.store || this.state.busy || this.state.saveState === "loading")
      throw new Error("Wait for browser storage to finish opening.");
    this.exports.clear();
    this.jobs.cancelAll();
    const epoch = this.epoch;
    this.update({ busy: true, error: null });
    let candidateRelease: (() => void) | null = null;
    try {
      const archive = /\.sidecut$/i.test(file.name);
      const filmora = /\.wfp$/i.test(file.name);
      if (file.size > (archive || filmora ? 256 : 20) * 1024 * 1024)
        throw new Error(
          archive || filmora
            ? "Archive exceeds the 256 MiB import limit."
            : "Project JSON exceeds the 20 MB import limit. Select a .tandem project, not a media file.",
        );
      let original: string;
      let resources: ArchiveResource[] = [];
      let warnings: string[] = [];
      if (archive) {
        const opened = openArchive(new Uint8Array(await file.arrayBuffer()));
        original = encodeProjectFile(opened.file);
        resources = opened.resources;
      } else if (filmora) {
        const imported = importFilmora(new Uint8Array(await file.arrayBuffer()));
        original = encodeProjectFile(imported.file);
        warnings = imported.report.warnings;
      } else {
        original = await file.text();
        const parsed = object(JSON.parse(original));
        if (parsed.edl != null && parsed.recipe != null) {
          const imported = importEDL(parsed.edl, parsed.recipe);
          original = encodeProjectFile(imported.file);
          warnings = imported.report.warnings;
        }
      }
      this.assertOpen(epoch);
      const metadata = object(JSON.parse(original)).project;
      if (!warnings.length && metadata && typeof metadata === "object" && "metadata" in metadata) {
        const report = object(metadata.metadata ?? {}).sidecutImportReport;
        if (typeof report === "string") {
          try {
            const stored = object(JSON.parse(report));
            if (
              Array.isArray(stored.warnings) &&
              stored.warnings.every((warning) => typeof warning === "string")
            )
              warnings = stored.warnings;
          } catch {
            /* Unknown import metadata does not prevent opening. */
          }
        }
      }
      const projectID = resources.length ? decodeProjectFile(JSON.parse(original)).project.id : "";
      if (archive) {
        const { restoreArchiveCaches } = await import("./service-archive-cache");
        await restoreArchiveCaches(resources);
      }
      // Stage copies before publishing a project that references them.
      for (const entry of resources) {
        if (entry.key.startsWith("cache:")) continue;
        await this.store.putResource(projectID, entry.key, {
          file: new File([entry.bytes.slice().buffer], entry.name, { type: entry.type }),
          state: "available",
          detail: "Restored from portable archive",
        });
        this.assertOpen(epoch);
      }
      if (archive)
        for (const use of assetUses(decodeProjectFile(JSON.parse(original)).project)) {
          if (use.asset.kind !== "font") continue;
          const resource = resources.find((entry) => entry.key === `asset-file:${use.asset.id}`);
          if (!resource) throw new Error(`Archived font is missing: ${use.asset.name}`);
          const { importFont } = await import("@sidecut/platform-browser/text");
          await importFont(
            new File([resource.bytes.slice().buffer], resource.name, { type: resource.type }),
          );
          this.assertOpen(epoch);
        }
      if (this.native && this.coordinator instanceof HostCoordinator) {
        this.coordinator.receive(await this.native.projectImport(original));
        await this.refreshMedia();
        this.update({ warnings });
        return;
      }
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
      this.update({ warnings });
    } catch (error) {
      candidateRelease?.();
      throw error;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  async createProject() {
    this.assertWritable();
    const json = encodeProjectFile(standardProject(`prj_${crypto.randomUUID()}`));
    await this.openProject(new File([json], "Untitled.tandem", { type: "application/json" }));
  }
  downloadProject(version = false) {
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
    anchor.download = `${this.state.project.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "Untitled"}${version ? ` r${this.state.revision}` : ""}.tandem`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  markReviewed() {
    this.assertWritable();
    if (!this.native) throw new Error("Agent review is available in the desktop app.");
    this.native.projectRequest(
      JSON.stringify({
        type: "markReviewed",
        projectID: this.state.project.id,
        generation: this.hostGeneration,
        revision: this.state.revision,
      }),
    );
  }

  async archiveBytes(
    options: { allowMissing?: boolean; preserveIdentity?: boolean; withCache?: boolean } = {},
  ) {
    if (!this.store) throw new Error("Storage is closed.");
    const epoch = this.epoch,
      file = this.projectFile();
    const stored = (await this.store.resources(file.project.id)).filter(
      ({ key }) => !key.startsWith("cache:"),
    );
    if (stored.reduce((sum, entry) => sum + entry.resource.file.size, 0) > 256 * 1024 * 1024)
      throw new Error("Archive exceeds the 256 MiB limit.");
    const resources: ArchiveResource[] = [];
    for (const { key, resource } of stored) {
      resources.push({
        key,
        name: resource.file.name,
        type: resource.file.type,
        bytes: new Uint8Array(await resource.file.arrayBuffer()),
      });
      this.assertOpen(epoch);
    }
    if (this.state.revision !== file.revision)
      throw new Error("Project changed during archive. Retry.");
    if (options.withCache) {
      const { archiveCaches } = await import("./service-archive-cache");
      resources.push(...(await archiveCaches(stored)));
    }
    return createArchive(file, resources, options);
  }

  async copyShortResources(projectID: string, signal: AbortSignal) {
    this.assertWritable();
    if (
      !this.store ||
      !/^prj_[a-zA-Z0-9_-]{1,120}$/.test(projectID) ||
      projectID === this.state.project.id
    )
      throw new Error("Invalid short-copy project ID.");
    const epoch = this.epoch,
      revision = this.state.revision,
      sourceID = this.state.project.id,
      check = () => {
        signal.throwIfAborted();
        this.assertOpen(epoch);
        if (this.state.revision !== revision)
          throw new Error("Project changed while copying resources.");
      };
    check();
    if ((await this.store.resources(projectID)).length)
      throw new Error("Short-copy resources already exist.");
    const resources = (await this.store.resources(sourceID)).filter(
      (r) => !r.key.startsWith("cache:"),
    );
    if (resources.reduce((total, r) => total + r.resource.file.size, 0) > 256 * 1024 * 1024)
      throw new Error("Short-copy resources exceed 256 MiB. Archive the source instead.");
    for (const resource of resources) {
      check();
      await this.store.putResource(projectID, resource.key, resource.resource);
    }
    check();
    return { resources: resources.length };
  }

  async downloadArchive() {
    this.assertWritable();
    if (!this.store) throw new Error("Storage is closed.");
    const epoch = this.epoch;
    this.update({ busy: true, error: null });
    try {
      await this.queue?.flush();
      await this.native?.projectFlush();
      const file = this.projectFile();
      const bytes = await this.archiveBytes();
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: "application/zip" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file.project.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "project"}.sidecut`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  async relinkMedia(mediaID: string, file: File) {
    this.assertWritable();
    if (!this.store) throw new Error("Storage is closed.");
    const original = this.state.project.media.find((m) => m.id === mediaID);
    if (!original) throw new Error("Source no longer exists in this project.");
    const epoch = this.epoch,
      revision = this.state.revision;
    this.update({ busy: true, error: null });
    try {
      const { item, resource } = await probeLocalFile(file);
      this.assertOpen(epoch);
      const identity = (fingerprint: string) => fingerprint.replace(/^(\d+)-\d+-/, "$1-");
      if (
        item.kind !== original.kind ||
        (original.fingerprint && identity(original.fingerprint) !== identity(item.fingerprint)) ||
        (original.duration &&
          (item.duration == null || Math.abs(original.duration.seconds - item.duration) > 0.1)) ||
        (original.width && original.width !== item.width) ||
        (original.height && original.height !== item.height)
      )
        throw new Error("Replacement does not match this source's identity or media properties.");
      if (this.state.revision !== revision)
        throw new Error("Project changed during relink. Retry.");
      const { id: _replacementID, role: _replacementRole, ...patch } = item;
      const batch = {
        label: "Relink source",
        expectedRevision: revision,
        commands: [{ updateMedia: { mediaID, patch } }],
      };
      new ProjectCoordinator(this.projectFile()).apply(batch);
      await this.store.putResource(this.state.project.id, mediaID, resource);
      this.assertOpen(epoch);
      this.coordinator.apply(batch);
      await this.queue?.flush();
      await this.refreshMedia();
      if (!original.fingerprint)
        this.update({
          warnings: [
            ...this.state.warnings,
            "Relink matched media properties; the original source had no content fingerprint.",
          ],
        });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }

  async importLUT(file: File): Promise<string> {
    this.assertWritable();
    if (!this.store) throw new Error("Browser storage is closed.");
    const epoch = this.epoch,
      projectID = this.state.project.id;
    this.update({ busy: true, error: null });
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("LUT exceeds the browser's 32 MB limit.");
      parseCube(await file.text());
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      this.assertOpen(epoch);
      await this.store.putResource(projectID, `lut:${file.name}`, {
        file,
        state: "available",
        detail: Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""),
      });
      this.assertOpen(epoch);
      await this.refreshMedia();
      return file.name;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
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

  async useLibraryAsset(
    entry: LibraryEntry,
    request: Record<string, unknown> = {},
    signal: AbortSignal = new AbortController().signal,
  ) {
    this.assertWritable();
    signal.throwIfAborted();
    if (!this.store || !entry.normalised)
      throw new Error("Asset file is missing. Fetch it into the library first.");
    const asset = decodeAsset(entry.asset),
      epoch = this.epoch,
      file = this.projectFile(),
      projectID = file.project.id;
    if (request.expectedRevision != null && request.expectedRevision !== file.revision)
      throw new Error("Stale revision. Retry with the latest project.");
    const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(asset.id)),
      ),
      alphabet = "abcdefghijkmnpqrstuvwxyz23456789",
      baseID = `med_${[...digest.slice(0, 8)].map((b) => alphabet[b % alphabet.length]).join("")}`,
      basePath = `assets/${asset.kind}/${asset.name.replace(/[^a-zA-Z0-9._-]/g, "_")}-${baseID.slice(4)}.${entry.normalised.name.split(".").at(-1)}`,
      known = file.project.media.find(
        (m) => object(m.asset ?? {}).id === asset.id || m.path === basePath,
      ),
      occupied = new Set([
        file.project.id,
        ...file.project.media.map((m) => m.id),
        ...file.project.markers.map((m) => m.id),
        ...[...file.project.videoTracks, ...file.project.audioTracks].flatMap((t) => [
          t.id,
          ...t.clips.map((c) => c.id),
          ...t.transitions.map((transition) => String(transition.id)),
        ]),
      ]);
    let mediaID = known?.id ?? baseID;
    if (!known) for (let n = 2; occupied.has(mediaID); n++) mediaID = `${baseID}_${n}`;
    const path =
        known?.path ??
        `assets/${asset.kind}/${asset.name.replace(/[^a-zA-Z0-9._-]/g, "_")}-${mediaID.slice(4)}.${entry.normalised.name.split(".").at(-1)}`,
      plan = assetUsePlan(file, asset, { mediaID, path }, request),
      batch = {
        label:
          request.label ??
          (request.at != null
            ? `Add ${asset.name} at ${request.at}`
            : `Add ${asset.name} to media`),
        author: request.author,
        expectedRevision: file.revision,
        commands: plan.commands,
      };
    if (plan.commands.length) {
      try {
        new ProjectCoordinator(file).apply(batch);
      } catch (error) {
        throw new QueryError(
          "badRequest",
          error instanceof Error ? error.message : "Invalid asset placement.",
        );
      }
    }
    const check = () => {
      signal.throwIfAborted();
      this.assertOpen(epoch);
      this.assertWritable();
      if (this.state.revision !== file.revision)
        throw new Error("Project changed while preparing the asset. Retry.");
    };
    check();
    let font: string | undefined, lut: string | undefined;
    const fonts: string[] = [];
    if (asset.kind === "font") {
      const { importFont } = await import("@sidecut/platform-browser/text");
      font = await importFont(entry.normalised);
      fonts.push(font);
      for (const extra of entry.extras ?? []) fonts.push(await importFont(extra));
      check();
    } else if (asset.kind === "lut") {
      parseCube(await entry.normalised.text());
      check();
      lut = path;
      await this.stageServiceResource(projectID, `lut:${path}`, entry.normalised, signal);
      check();
    }
    const key = plan.mediaID ?? `asset-file:${asset.id}`;
    if (!plan.mediaID || !(await this.store.resource(projectID, key))) {
      check();
      await this.stageServiceResource(projectID, key, entry.normalised, signal);
      check();
    }
    for (const [index, extra] of (entry.extras ?? []).entries()) {
      await this.stageServiceResource(projectID, `asset-extra:${asset.id}:${index}`, extra, signal);
      check();
    }
    if (entry.licence) {
      await this.stageServiceResource(
        projectID,
        `asset-licence:${asset.id}`,
        entry.licence,
        signal,
      );
      check();
    }
    const applied = plan.commands.length ? this.apply(batch) : undefined;
    await this.queue?.flush();
    await this.refreshMedia();
    return {
      ...(font ? { font } : {}),
      ...(lut ? { lut } : {}),
      ...(plan.mediaID ? { mediaID: plan.mediaID } : {}),
      files: [path, ...(entry.extras ?? []).map((f) => f.name)],
      role: plan.role,
      trackName: plan.trackName,
      gainDB: plan.gainDB,
      at: request.at,
      applied,
      fonts: [...new Set(fonts)],
      ...(font ? { fontsReached: "app" } : {}),
    };
  }

  async stageServiceResource(projectID: string, mediaID: string, file: File, signal: AbortSignal) {
    this.assertWritable();
    signal.throwIfAborted();
    if (!this.store || this.state.project.id !== projectID)
      throw new Error("Project was replaced.");
    const epoch = this.epoch;
    await this.store.putResource(projectID, mediaID, {
      file,
      state: "available",
      detail: "Available from local asset library",
    });
    signal.throwIfAborted();
    this.assertOpen(epoch);
  }

  async saveSelectionAsSegment(
    ids: readonly string[],
    name: string,
    options: { fields?: readonly SegmentField[]; replace?: boolean; signal?: AbortSignal } = {},
  ) {
    this.assertWritable();
    if (!this.store) throw new Error("Browser storage is closed.");
    const epoch = this.epoch,
      { project, revision } = this.state,
      segment = makeSegment(project, ids, name, new Date().toISOString(), options.fields),
      resources: SegmentEntry["resources"] = {};
    segment.storageID = crypto.randomUUID();
    this.update({ busy: true });
    let library: SegmentLibrary | undefined;
    try {
      for (const item of segment.resources) {
        options.signal?.throwIfAborted();
        const source = await this.store.resource(project.id, item.key);
        this.assertOpen(epoch);
        if (source?.state !== "available" && item.optional) continue;
        if (source?.state !== "available")
          throw new QueryError(
            "notFound",
            `Cannot save segment: ${item.key} is missing. Import or relink it first.`,
          );
        resources[item.path] = source;
      }
      if (this.state.revision !== revision)
        throw new Error("Project changed while saving the segment. Try again.");
      segment.resources = segment.resources.filter((r) => resources[r.path]);
      library = await SegmentLibrary.open();
      this.assertOpen(epoch);
      options.signal?.throwIfAborted();
      if (this.state.revision !== revision)
        throw new Error("Project changed while saving the segment. Try again.");
      await library.save({ segment, resources }, options.replace);
      return segment;
    } finally {
      library?.close();
      if (this.epoch === epoch) this.update({ busy: false });
    }
  }
  async insertSavedSegment(
    entry: SegmentEntry,
    at: number,
    mode: "place" | "overwrite" | "insert" = "place",
    options: {
      values?: Record<string, string> | undefined;
      label?: string | undefined;
      author?: string | undefined;
      expectedRevision?: number | undefined;
      signal?: AbortSignal;
    } = {},
  ) {
    this.assertWritable();
    if (!this.store) throw new Error("Browser storage is closed.");
    const epoch = this.epoch,
      { project, revision } = this.state,
      template = insertableSegment(entry.segment),
      prefix = segmentPrefix(entry.segment);
    const command = {
        insertTemplate: {
          template,
          at,
          mode,
          ...(options.values ? { values: options.values } : {}),
        },
      },
      batch = {
        label: options.label ?? `Add segment ${entry.segment.name}`,
        ...(options.author == null ? {} : { author: options.author }),
        expectedRevision: options.expectedRevision ?? revision,
        idempotencyKey: crypto.randomUUID(),
        commands: [command],
      };
    const known = new Set(entry.segment.template.fields.map((f) => f.key));
    for (const key of Object.keys(options.values ?? {}))
      if (!known.has(key))
        throw new QueryError("badRequest", `${entry.segment.name} has no field "${key}".`);
    options.signal?.throwIfAborted();
    const preview = new ProjectCoordinator({ revision, project });
    preview.apply(batch);
    const planned = preview.getSnapshot().project;
    for (const item of entry.segment.resources)
      if (entry.resources[item.path]?.state !== "available")
        throw new QueryError(
          "notFound",
          `Saved segment is missing ${item.path}. Save it again from its source project.`,
        );
    this.update({ busy: true });
    try {
      for (const item of entry.segment.resources) {
        options.signal?.throwIfAborted();
        this.assertOpen(epoch);
        const media = planned.media.find((m) => m.path === `${prefix}${item.path}`),
          key = media?.id ?? (item.key.startsWith("lut:") ? `lut:${prefix}${item.path}` : item.key),
          existing = await this.store.resource(project.id, key);
        if (!existing) await this.store.putResource(project.id, key, entry.resources[item.path]!);
        if (
          item.key.startsWith("asset-file:") &&
          entry.segment.assets.some(
            (a) => a.asset.id === item.key.slice(11) && a.asset.kind === "font",
          )
        ) {
          const { importFont } = await import("@sidecut/platform-browser/text");
          await importFont(entry.resources[item.path]!.file);
        }
      }
      this.assertOpen(epoch);
      let metadata = project.metadata;
      for (const use of entry.segment.assets) {
        const media = planned.media.find(
            (m) => m.asset && decodeAsset(m.asset).id === use.asset.id,
          ),
          lut = entry.segment.resources.find((r) => r.key === `lut:${use.path}`);
        metadata = recordAssetUse(
          { ...project, metadata },
          {
            asset: use.asset,
            ...(media
              ? { mediaID: media.id, path: media.path }
              : use.path
                ? { path: lut ? `${prefix}${lut.path}` : use.path }
                : {}),
          },
        );
      }
      options.signal?.throwIfAborted();
      const result = this.coordinator.apply({
        ...batch,
        commands: [command, { updateProject: { patch: { metadata } } }],
      });
      await this.queue?.flush();
      await this.refreshMedia();
      return result;
    } finally {
      if (this.epoch === epoch) this.update({ busy: false });
    }
  }

  private async refreshMedia() {
    const epoch = this.epoch;
    const { project, revision } = this.state;
    const availability: Record<string, MediaAvailability> = {};
    await Promise.all(
      project.media.map(async (item) => {
        const resource = await this.resource(item.id);
        availability[item.id] = resource
          ? { state: resource.state, detail: resource.detail }
          : {
              state: "missing",
              detail: "Source is not stored on this device. Relink it or open a portable archive.",
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
    this.exports.clear();
    this.jobs.cancelAll();
    this.analysis.reset();
    this.exportController?.abort();
    ++this.epoch;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.folderStop?.();
    this.folderStop = null;
    if (this.coordinator instanceof HostCoordinator) this.coordinator.close();
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
