import {
  DurableStorage,
  nativeFile,
  discardNativeFile,
} from "@sidecut/platform-browser/sqlite-client";
import { DeliveryStore } from "@sidecut/core/delivery-store";
import type { Delivery } from "@sidecut/contracts/delivery";
import { decodeNativeRecording } from "@sidecut/contracts/native-recording";
import type { FolderMedia } from "@sidecut/contracts/desktop";
import { createArchive, openArchive, type ArchiveResource } from "@sidecut/core/archive";
import { importEDL, importFilmora, object } from "@sidecut/core/interchange";
import { HostCoordinator, nativeBridge } from "./host-coordinator";
import {
  captureTransition,
  deriveStatus,
  saveProgress,
  sessionTransition,
  type CaptureCause,
  type Backend,
  type NativeHost,
  type OpenSession,
  type OperationName,
  type SessionEvent,
  type SessionState,
  type SessionStep,
} from "./project-session-state";
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
import type { HostSnapshot } from "@sidecut/contracts/desktop";
import { BrowserJobs } from "@sidecut/platform-browser/jobs";
import { BrowserRecording, type RecordingRequest } from "@sidecut/platform-browser/recording";
import { releaseExport } from "@sidecut/platform-browser/export-output";
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

type SessionData = Omit<
  BrowserSnapshot,
  "saveState" | "readOnly" | "busy" | "error" | "unsupportedJSON"
>;

export class BrowserProjectSession {
  readonly jobs = new BrowserJobs(2);
  readonly exports = new ExportQueue();
  queueExport(
    format: string | null = null,
    preset: ExportPreset | "wav" = "webm",
    range: { from: number; to: number } | null = null,
    encoding: "webm" | "h264" | "hevc" = "webm",
  ) {
    this.exports.assertAvailable();
    if (preset === "wav") encoding = "webm";
    format = preset === "short" ? "portrait" : preset === "wav" ? null : format;
    const file = this.projectFile();
    const snapshotJSON = encodeProjectFile(file);
    const project = decodeProjectFile(JSON.parse(snapshotJSON)).project;
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
    const name = `${project.name.replace(/[\\/:*?"<>|]/g, "_") || "SideCut"}${format ? ` ${format}` : ""}${preset === "webm" ? "" : ` ${preset}`}${bounds ? ` ${bounds.from.toFixed(3)}-${bounds.to.toFixed(3)}s` : ""}.${preset === "wav" ? "wav" : encoding === "webm" ? "webm" : "mp4"}`;
    return this.exports.enqueue(
      name,
      async (signal, progress) =>
        preset === "wav"
          ? this.exportWAV(signal, progress, project, bounds)
          : this.exportWebM(signal, progress, format, preset, bounds, project),
      preset,
      {
        snapshotJSON,
        startSeconds: bounds?.from ?? 0,
        durationSeconds: bounds ? bounds.to - bounds.from : projectDuration(project).seconds,
      },
      this.deliveryRecipe(file, snapshotJSON, format, preset, bounds, encoding),
    );
  }
  private async deliveryRecipe(
    file: ProjectFile,
    snapshotJSON: string,
    format: string | null,
    preset: ExportPreset | "wav",
    bounds: { from: number; to: number } | null,
    encoding: "webm" | "h264" | "hevc",
  ): Promise<Delivery["recipe"]> {
    if (!this.store) throw new Error("Project storage is unavailable.");
    const store = this.store;
    const resources = await store.resources(file.project.id);
    const storage = await DurableStorage.open();
    const saved: Array<Delivery["recipe"]["resources"][number]> = [];
    try {
      for (const { key, resource } of resources) {
        const fileID = await storage.putBlob(
          resource.file.slice(0, resource.file.size, resource.file.type),
        );
        saved.push({
          id: key,
          fileID,
          name: resource.file.name,
          type: resource.file.type,
          lastModified: resource.file.lastModified,
          state: resource.state,
          detail: resource.detail,
        });
      }
    } catch (error) {
      await Promise.allSettled(saved.map((item) => storage.removeFile(item.fileID)));
      throw error;
    }
    return {
      snapshotJSON,
      projectID: file.project.id,
      revision: file.revision,
      resourceIDs: saved.map((item) => item.id),
      resources: saved,
      format,
      preset,
      encoding,
      startSeconds: bounds?.from ?? 0,
      durationSeconds: bounds ? bounds.to - bounds.from : projectDuration(file.project).seconds,
    };
  }
  private async configureExports() {
    const epoch = this.epoch;
    const storage = await DurableStorage.open();
    if (epoch !== this.epoch || this.machine.kind !== "open") return;
    await this.exports.configure({
      store: new DeliveryStore(storage),
      putBlob: storage.putBlob,
      getBlob: storage.getBlob,
      removeFile: storage.removeFile,
      run: async (recipe, signal, progress) => {
        const project = decodeProjectFile(JSON.parse(recipe.snapshotJSON)).project;
        const resources = new Map(recipe.resources.map((resource) => [resource.id, resource]));
        const resource = async (id: string) => {
          const item = resources.get(id);
          if (!item) return null;
          const file = await storage.getBlob(item.fileID, item.type, item.name, item.lastModified);
          if (!(file instanceof File)) throw new Error("Stored export resource is invalid.");
          return { file, state: item.state, detail: item.detail };
        };
        const range = {
          from: recipe.startSeconds,
          to: recipe.startSeconds + recipe.durationSeconds,
        };
        if (recipe.preset === "wav")
          return this.exportWAV(signal, progress, project, range, resource);
        const encoding = recipe.encoding ?? "webm";
        const blob = await this.exportWebM(
          signal,
          (value) => progress(value * (encoding === "webm" ? 1 : 0.7)),
          recipe.format,
          recipe.preset,
          range,
          project,
          resource,
        );
        if (encoding === "webm") return blob;
        if (!this.native?.deliveryEncode || !this.native.deliveryCancel) {
          await releaseExport(blob);
          throw new Error("Native MP4 delivery requires the desktop application.");
        }
        const inputID = await storage.putBlob(blob),
          requestID = crypto.randomUUID();
        const abort = () => {
          void this.native?.deliveryCancel?.(requestID).catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          signal.throwIfAborted();
          const settings = exportPresetPlan(project, recipe.preset, recipe.format);
          const output = await this.native.deliveryEncode(requestID, inputID, {
            codec: encoding,
            videoBitrate: settings.videoBitrate,
            audioBitrate: 192000,
            name: `${project.name.replace(/[\\/:*?"<>|]/g, "_") || "SideCut"}.mp4`,
          });
          signal.throwIfAborted();
          const file = await nativeFile(output);
          progress(1);
          await storage.removeFile(inputID);
          return file;
        } finally {
          signal.removeEventListener("abort", abort);
          await releaseExport(blob);
        }
      },
    });
  }
  readonly analysis = new MediaAnalysis(this);
  readonly recording = new BrowserRecording(undefined, nativeBridge());
  recordingProjectID: string | null = null;
  recordingRequest: RecordingRequest | null = null;
  async startRecording(request: RecordingRequest) {
    this.assertWritable();
    if (!["idle", "error"].includes(this.recording.getSnapshot().status))
      throw new Error("Finish or discard the current recording first.");
    this.recordingProjectID = this.state.project.id;
    this.recordingRequest = request;
    await this.recording.start(request, this.recordingProjectID);
  }
  async importRecording() {
    this.assertWritable();
    const capture = this.recording.getSnapshot();
    if (capture.status !== "ready")
      throw new Error("Finish recording before adding it to the project.");
    if (this.recordingProjectID !== this.state.project.id)
      throw new Error("Return to the original project to add this recording, or download it.");
    if (this.state.saveState === "error") await this.retrySave();
    await this.importFiles([capture.file]);
    await this.recording.discard();
  }
  async importNativeRecording(id: string, mode: "media" | "new-project"): Promise<void> {
    this.assertWritable();
    const bridge = this.native;
    if (
      (!(bridge?.nativeRecordingAdopt && bridge.nativeRecordingList) &&
        !bridge?.nativeRecordingRead) ||
      !this.store
    )
      throw new Error("Native recording import is unavailable.");
    const epoch = this.epoch,
      projectID = this.state.project.id,
      revision = this.state.revision;
    const check = () => {
      this.assertOpen(epoch);
      if (
        this.state.project.id !== projectID ||
        this.state.revision !== revision ||
        this.state.readOnly ||
        !this.state.busy
      )
        throw new Error("The project changed while importing the recording.");
    };
    let adoptedFileID: string | undefined;
    let resourceCommitted = false;
    const operation = this.begin("native-recording", { clearError: true });
    try {
      if (this.state.saveState === "error") {
        if (this.native) await this.native.projectFlush();
        else {
          this.queue?.enqueue(this.projectFile());
          await this.queue?.flush();
        }
        check();
      }
      let recording;
      let file: File;
      if (bridge.nativeRecordingAdopt && bridge.nativeRecordingList) {
        const recordings = await bridge.nativeRecordingList();
        recording = decodeNativeRecording(recordings.find((entry) => entry.id === id));
        if (recording.id !== id || recording.status !== "ready")
          throw new Error("Recording is not ready.");
        const reference = await bridge.nativeRecordingAdopt(id);
        adoptedFileID = reference.id;
        check();
        file = await nativeFile(reference);
      } else {
        const asset = await bridge.nativeRecordingRead!(id);
        check();
        recording = decodeNativeRecording(asset.recording);
        if (
          recording.id !== id ||
          recording.status !== "ready" ||
          !(asset.bytes instanceof Uint8Array) ||
          !asset.bytes.length ||
          asset.bytes.length > 128 * 1024 * 1024 ||
          (asset.type !== "video/mp4" && asset.type !== "audio/mp4") ||
          !asset.name
        )
          throw new Error("Invalid native recording asset.");
        file = new File([asset.bytes.slice().buffer], asset.name, { type: asset.type });
      }
      const { item, resource } = await probeLocalFile(file);
      check();
      if (resource.state !== "available")
        throw new Error(`Cannot read recording: ${resource.detail}`);
      const tracks = recording.tracks;
      if (
        !tracks.length ||
        tracks.some((track) => track.durationSeconds <= 0 || track.startSeconds < 0) ||
        tracks.some((track) => (track.kind === "video" ? !item.hasVideo : !item.hasAudio))
      )
        throw new Error("Recording tracks do not match the media.");
      const media = {
        ...item,
        nativeRecording: {
          id: recording.id,
          projectID: recording.projectID,
          source: recording.source,
          tracks,
        },
      };
      if (mode === "media") {
        const existing = this.state.project.media.find(
          (entry) =>
            mediaIdentity(entry.path, entry.fingerprint) ===
            mediaIdentity(item.path, item.fingerprint),
        );
        await this.store.putResource(projectID, existing?.id ?? item.id, resource);
        resourceCommitted = true;
        check();
        this.coordinator.apply({
          label: "Import native recording",
          expectedRevision: this.state.revision,
          commands: [
            existing
              ? {
                  updateMedia: {
                    mediaID: existing.id,
                    patch: { nativeRecording: media.nativeRecording },
                  },
                }
              : { addMedia: { item: media } },
          ],
        });
        if (this.native) await this.native.projectFlush();
        else await this.queue?.flush();
        this.assertOpen(epoch);
        await this.refreshMedia();
        return;
      }
      if (mode !== "new-project") throw new Error("Unknown recording import mode.");
      const base = standardProject(`prj_${crypto.randomUUID()}`);
      const raw = JSON.parse(encodeProjectFile(base));
      raw.project.media = [media];
      const linkGroup = tracks.length > 1 ? `link_${crypto.randomUUID()}` : undefined;
      const origin = Math.min(...tracks.map((track) => track.startSeconds));
      for (const track of tracks) {
        const offset = track.startSeconds;
        // Older probe versions can include the initial timestamp gap in stream duration.
        const duration = Math.min(track.durationSeconds, (item.duration ?? Infinity) - offset);
        if (duration <= 0) throw new Error("Recording track starts beyond the playable media.");
        const clip = {
          id: `clip_${crypto.randomUUID()}`,
          content: { media: { mediaID: item.id } },
          start: offset - origin,
          sourceStart: offset,
          duration,
          ...(linkGroup ? { linkGroup } : {}),
        };
        const target =
          track.kind === "video"
            ? raw.project.videoTracks[recording.source === "camera" ? 1 : 0]
            : raw.project.audioTracks[0];
        target.clips = [...(target.clips ?? []), clip];
      }
      const candidate = decodeProjectFile(raw);
      new ProjectCoordinator(candidate).getSnapshot();
      await this.store.putResource(candidate.project.id, item.id, resource);
      resourceCommitted = true;
      check();
      const json = encodeProjectFile(candidate);
      // Hand the foreground slot to the replacement operation.
      this.finish(operation);
      await this.openProject(new File([json], "Recording.tandem", { type: "application/json" }));
    } finally {
      if (adoptedFileID && !resourceCommitted)
        await discardNativeFile(adoptedFileID).catch(() => {});
      this.finish(operation);
    }
  }
  /** Authoritative lifecycle: opening/open(backend, persistence, error, operation)/closing/closed/failed. */
  private machine: SessionState = { kind: "opening", epoch: 0 };
  /** Last document view, kept for reads once the backend that produced it was retired. */
  private retiredView: ProjectCoordinator | HostCoordinator = new ProjectCoordinator(
    standardProject("prj_loading"),
  );
  private folderPending = Promise.resolve();
  readonly native = nativeBridge();
  private state: BrowserSnapshot = {
    warnings: [],
    ...this.retiredView.getSnapshot(),
    ...deriveStatus(this.machine),
    mediaAvailability: {},
  };
  private listeners = new Set<() => void>();
  private get epoch() {
    return this.machine.epoch;
  }
  private get open(): OpenSession | null {
    return this.machine.kind === "open" ? this.machine : null;
  }
  private get store() {
    return this.open?.store ?? null;
  }
  private get coordinator(): ProjectCoordinator | HostCoordinator {
    return this.open?.backend.coordinator ?? this.retiredView;
  }
  private get queue() {
    const backend = this.open?.backend;
    return backend?.kind === "browserWriter" ? backend.queue : null;
  }
  private get host(): NativeHost | null {
    const backend = this.open?.backend;
    return backend?.kind === "nativeHost" ? backend : null;
  }
  private get unsupportedOriginal() {
    return deriveStatus(this.machine).unsupportedJSON;
  }

  /** Applies a named transition without notifying; callers publish once their data patch is ready. */
  private transition(event: SessionEvent): SessionStep {
    const before = this.machine;
    const step = sessionTransition(before, event);
    this.machine = step.state;
    if (step.state !== before) this.guardCapture(this.machineCause(before, step.state));
    return step;
  }
  /** What a lifecycle transition changed that capture is bound to, if anything. */
  private machineCause(before: SessionState, after: SessionState): CaptureCause | null {
    if (before.epoch !== after.epoch) return "epoch";
    const backend = (state: SessionState) => (state.kind === "open" ? state.backend : null);
    if (backend(before) !== backend(after)) return "backend";
    if (deriveStatus(before).readOnly !== deriveStatus(after).readOnly) return "ownership";
    return null;
  }
  private directedCapture: unknown = null;
  /**
   * Named effect: capture belongs to the project and write access it started with. It runs when
   * ownership, backend, epoch or project change, never from snapshot publication, and acts at
   * most once per capture state.
   */
  private guardCapture(cause: CaptureCause | null) {
    if (!cause) return;
    const capture = this.recording.getSnapshot();
    if (capture === this.directedCapture) return;
    const action = captureTransition({
      cause,
      readOnly: deriveStatus(this.machine).readOnly,
      projectID: this.state.project.id,
      boundProjectID: this.recordingProjectID,
      status: capture.status,
    });
    if (action === "none") return;
    this.directedCapture = capture;
    if (action === "discard") void this.recording.discard().catch(() => {});
    else this.recording.stop();
  }
  /** Last durable revision and newest outstanding save of the open session. */
  saveProgress() {
    return saveProgress(this.machine);
  }
  private send(event: SessionEvent): SessionStep {
    const step = this.transition(event);
    this.publish();
    return step;
  }
  /** Foreground operation: begin/finish with an owner token. Stale finishes are ignored. */
  private begin(
    name: OperationName,
    options: { clearError?: boolean; controller?: AbortController } = {},
  ): { epoch: number; token: number } {
    const epoch = this.epoch;
    const step = this.send({
      type: "operationBegun",
      epoch,
      name,
      clearError: options.clearError ?? false,
      ...(options.controller ? { controller: options.controller } : {}),
    });
    return { epoch, token: step.token! };
  }
  private finish(operation: { epoch: number; token: number }) {
    const before = this.machine;
    const step = this.transition({ type: "operationEnded", ...operation });
    if (step.state !== before) this.publish();
  }
  private raise(cause: unknown, source: "operation" | "background" = "background") {
    this.send({
      type: "errorRaised",
      epoch: this.epoch,
      error: { source, message: message(cause) },
    });
  }
  private disposeBackend(backend: Backend, options: { keepLock?: boolean } = {}) {
    backend.unsubscribe();
    if (backend.kind === "nativeHost") {
      backend.folderStop?.();
      backend.coordinator.close();
    }
    if (backend.kind === "browserWriter" && !options.keepLock) backend.release();
  }
  /** Releases everything an open session owned, exactly once, after the machine moved on. */
  private draining: Promise<"saved" | "error" | null> | null = null;
  private disposeOpen(open: OpenSession) {
    this.retiredView = open.backend.coordinator;
    this.disposeBackend(open.backend, { keepLock: true });
    const previous = this.draining;
    this.draining = (async () => {
      await previous;
      try {
        if (open.backend.kind === "browserWriter") await open.backend.queue.flush();
        return open.backend.kind === "browserWriter" ? ("saved" as const) : null;
      } catch {
        /* The last successfully committed snapshot remains intact. */
        return "error" as const;
      } finally {
        open.channel?.close();
        if (open.backend.kind === "browserWriter") open.backend.release();
        open.store.close();
      }
    })();
    return this.draining;
  }
  private retireBackend(
    step: { retired?: OpenSession | Backend },
    options: { keepLock?: boolean } = {},
  ) {
    const retired = step.retired;
    if (!retired) return;
    if ("store" in retired) return this.disposeOpen(retired);
    else {
      this.retiredView = retired.coordinator;
      this.disposeBackend(retired, options);
    }
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(): Promise<void> {
    const started = this.transition({ type: "start" });
    started.abort?.abort();
    const epoch = this.epoch;
    const retired = this.retireBackend(started);
    this.publish();
    // Resources acquired while opening stay here until `opened` hands them to the machine.
    let store: BrowserProjectStore | null = null;
    let release: (() => void) | null = null;
    let channel: BroadcastChannel | null = null;
    let installed = false;
    try {
      const draining = retired ?? this.draining;
      if (draining) await draining;
      if (epoch !== this.epoch) return;
      store = await BrowserProjectStore.open();
      if (epoch !== this.epoch) {
        store.close();
        return;
      }
      if (this.native) {
        const { backend, initial } = this.hostBackend();
        this.transition({
          type: "opened",
          epoch,
          store,
          channel: null,
          backend,
          ...(initial ? { persistence: initial.saveState } : {}),
        });
        installed = true;
        if (initial)
          this.transition({
            type: "hostStatus",
            epoch,
            host: backend.coordinator,
            status: initial.saveState,
            revision: backend.coordinator.getSnapshot().revision,
            sequence: initial.sequence,
            generation: initial.generation,
            ...(initial.error ? { message: initial.error } : {}),
          });
        this.update({
          ...coordinatorState(backend.coordinator),
          reviewPendingCount: initial?.reviewPendingCount ?? 0,
        });
        await this.refreshMedia();
        if (epoch !== this.epoch) return;
        await this.configureExports();
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
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("sidecut.project.changes");
        channel.onmessage = (event) => {
          if (event.data === this.state.project.id && this.state.readOnly && !this.state.busy)
            void this.refreshReadOnly().catch((error) => this.raise(error));
        };
      }
      const built = this.browserBackend(epoch, latest, store, channel, release);
      this.transition({
        type: "opened",
        epoch,
        store,
        channel,
        backend: built.backend,
        savedRevision: latest.revision,
      });
      installed = true;
      this.update(built.data);
      await this.refreshMedia();
      if (epoch !== this.epoch) return;
      await this.configureExports();
    } catch (error) {
      if (!installed) {
        release?.();
        channel?.close();
        store?.close();
      }
      if (epoch === this.epoch) {
        const failed = this.transition({ type: "openFailed", epoch, message: message(error) });
        failed.abort?.abort();
        const failedDrain = this.retireBackend(failed);
        this.publish();
        await failedDrain;
      }
    }
  }

  /** Native desktop host: the host coordinator and its folder watch belong to this backend. */
  private hostBackend(): { backend: NativeHost; initial: HostSnapshot | undefined } {
    const native = this.native!;
    let initial: HostSnapshot | undefined;
    let live = false;
    const coordinator = new HostCoordinator(native, (value) => {
      initial = value;
      if (!live) return;
      this.transition({
        type: "hostStatus",
        epoch: this.epoch,
        host: coordinator,
        status: value.saveState,
        revision: coordinator.getSnapshot().revision,
        sequence: value.sequence,
        generation: value.generation,
        ...(value.error ? { message: value.error } : {}),
      });
      this.publish({ reviewPendingCount: value.reviewPendingCount ?? 0 });
    });
    live = true;
    const unsubscribe = coordinator.subscribe(() => {
      const host = this.host;
      if (!host || host.coordinator !== coordinator) return;
      if (coordinator.generation !== host.generation) {
        // The host replaced the project: invalidate older work and cancel owned operations.
        const step = this.transition({
          type: "hostGenerationChanged",
          epoch: this.epoch,
          generation: coordinator.generation,
        });
        step.abort?.abort();
        this.jobs.cancelAll();
        this.analysis.reset();
        this.publish({ mediaAvailability: {} });
      }
      this.update(coordinatorState(coordinator));
      void this.refreshMedia().catch((error) => this.raise(error));
    });
    const folderStop = native.folderSubscribe((files, error) => {
      if (error) {
        this.send({
          type: "errorRaised",
          epoch: this.epoch,
          error: { source: "background", message: error },
        });
        return;
      }
      const projectID = this.state.project.id;
      const folderEpoch = this.epoch;
      this.folderPending = this.folderPending
        .then(async () => {
          if (this.state.busy)
            await new Promise<void>((resolve) => {
              const stop = this.subscribe(() => {
                if (!this.state.busy || folderEpoch !== this.epoch) {
                  stop();
                  resolve();
                }
              });
            });
          if (folderEpoch !== this.epoch || projectID !== this.state.project.id) return;
          await this.importFolderMedia(files);
        })
        .catch((cause) => {
          if (folderEpoch === this.epoch) this.raise(cause);
        });
    });
    return {
      backend: {
        kind: "nativeHost",
        coordinator,
        generation: coordinator.generation,
        unsubscribe,
        folderStop,
      },
      initial,
    };
  }

  async reloadNativeProject(backup = false) {
    const host = this.host;
    if (!this.native || !host) return;
    host.coordinator.receive(await this.native.projectReload(backup));
  }

  private async importFolderMedia(files: FolderMedia[]) {
    if (!this.store || !this.native) return;
    this.assertWritable();
    const epoch = this.epoch;
    const operation = this.begin("folder");
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
      this.finish(operation);
    }
  }

  async watchFolder() {
    await this.native?.folderSelect();
  }

  /** Builds a browser backend: writer (lock + SaveQueue), follower, or unsupported (read-only). */
  private browserBackend(
    epoch: number,
    file: ProjectFile,
    store: BrowserProjectStore,
    channel: BroadcastChannel | null,
    lock: (() => void) | null,
    original?: string,
  ): { backend: Backend; data: Partial<SessionData> } {
    this.jobs.cancelAll();
    this.analysis.reset();
    const coordinator = new ProjectCoordinator(file);
    let backend!: Backend;
    const unsubscribe = coordinator.subscribe(() => {
      this.update(coordinatorState(coordinator));
      if (backend.kind === "browserWriter") backend.queue.enqueue(coordinator.projectFile());
      void this.refreshMedia().catch((error) => this.raise(error));
    });
    if (lock) {
      const queue = new SaveQueue(
        async (snapshot) => {
          await store.save(snapshot);
          channel?.postMessage(snapshot.project.id);
        },
        (status, error) => {
          this.transition({
            type: "persistence",
            epoch,
            backend,
            status,
            ...(error
              ? { message: `Could not save: ${message(error)}. Download a copy or retry.` }
              : {}),
          });
          this.publish();
        },
        (save) => this.transition({ type: "saveRecorded", epoch, backend, save }),
      );
      backend = { kind: "browserWriter", coordinator, release: lock, queue, unsubscribe };
    } else if (original !== undefined)
      backend = { kind: "unsupported", coordinator, original, unsubscribe };
    else backend = { kind: "browserFollower", coordinator, unsubscribe };
    return {
      backend,
      data: {
        ...coordinatorState(coordinator),
        mediaAvailability: {},
        warnings: [
          ...(typeof file.sidecutRecovery === "string" ? [file.sidecutRecovery] : []),
          ...validateProject(file.project)
            .filter((issue) => issue.severity === "warning")
            .map((issue) => issue.message),
        ],
      },
    };
  }

  /** Replaces the backend of an open session; the retired backend is disposed after the switch. */
  private installBackend(
    file: ProjectFile,
    backend: { lock: (() => void) | null; original?: string },
    extra: Partial<SessionData> = {},
    options: { keepLock?: boolean } = {},
  ) {
    const open = this.open;
    if (!open) throw new Error("The project session was closed.");
    const built = this.browserBackend(
      this.epoch,
      file,
      open.store,
      open.channel,
      backend.lock,
      backend.original,
    );
    this.retireBackend(
      this.transition({
        type: "backendInstalled",
        epoch: this.epoch,
        backend: built.backend,
        savedRevision: file.revision,
      }),
      options,
    );
    this.update({ ...built.data, ...extra });
  }

  /** Document data changed: ordinary content ("data") or a different project ("project"). */
  private update(patch: Partial<SessionData>) {
    const projectID = this.state.project.id;
    this.derive(patch);
    this.guardCapture(this.state.project.id === projectID ? "data" : "project");
    this.notify();
  }
  private derive(patch: Partial<SessionData>) {
    this.state = Object.freeze({ ...this.state, ...patch, ...deriveStatus(this.machine) });
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  /** Snapshot derivation and notification only; side effects belong to named transitions. */
  private publish(patch: Partial<SessionData> = {}) {
    this.derive(patch);
    this.notify();
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

  async exportWAV(
    signal: AbortSignal,
    progress: (value: number) => void,
    project: ProjectFile["project"],
    range: { from: number; to: number } | null,
    resolve?: (id: string) => ReturnType<BrowserProjectStore["resource"]>,
  ) {
    if (!this.store || this.state.busy || this.state.saveState === "loading")
      throw new Error("Wait for the current project operation to finish.");
    const store = this.store;
    const operation = this.begin("export");
    try {
      const { renderWAV } = await import("@sidecut/platform-browser/wav-export");
      return await this.jobs.run("export", "Export audio", 10, signal, (jobSignal) =>
        renderWAV(
          project,
          resolve ?? ((id) => store.resource(project.id, id)),
          jobSignal,
          progress,
          range?.from ?? 0,
          range?.to ?? projectDuration(project).seconds,
        ),
      );
    } finally {
      this.finish(operation);
    }
  }

  async exportWebM(
    signal: AbortSignal,
    onProgress: (progress: number) => void,
    format: string | null = null,
    preset: ExportPreset = "webm",
    range: { from: number; to: number } | null = null,
    snapshotProject: ProjectFile["project"] = this.state.project,
    snapshotResource?: (id: string) => ReturnType<BrowserProjectStore["resource"]>,
  ) {
    if (!this.store || this.state.busy || this.state.saveState === "loading")
      throw new Error("Wait for the current project operation to finish.");
    const store = this.store,
      settings = exportPresetPlan(snapshotProject, preset, format),
      project = settings.project,
      controller = new AbortController();
    const operation = this.begin("export", { controller });
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
            snapshotResource ?? ((id) => store.resource(project.id, id)),
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
      this.finish(operation);
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
    if (this.unsupportedOriginal)
      throw new Error("This imported project uses unsupported data and must stay read-only.");
    const open = this.open;
    if (!open || !this.state.readOnly || this.state.busy) return;
    const epoch = this.epoch;
    const operation = this.begin("editing", { clearError: true });
    let release: (() => void) | null = null;
    let installed = false;
    try {
      release = await acquireProjectWriter(this.state.project.id);
      this.assertOpen(epoch);
      if (!release)
        throw new Error("Another tab is still editing this project. Close it and try again.");
      const latest = await open.store.load(this.state.project.id);
      this.assertOpen(epoch);
      if (!latest) throw new Error("The saved project was not found.");
      this.installBackend(latest, { lock: release });
      installed = true;
      await this.refreshMedia();
    } catch (error) {
      if (!installed) release?.();
      if (epoch === this.epoch) this.raise(error, "operation");
    } finally {
      this.finish(operation);
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
      !this.unsupportedOriginal &&
      this.state.project.id === id &&
      !this.state.busy
    ) {
      this.installBackend(latest, { lock: null });
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
    this.jobs.cancelAll();
    const epoch = this.epoch;
    const operation = this.begin("replace", { clearError: true });
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
      const host = this.host;
      if (this.native && host) {
        host.coordinator.receive(await this.native.projectImport(original));
        await this.refreshMedia();
        this.update({ warnings });
        return;
      }
      const inspected = inspectProjectFile(JSON.parse(original));
      if (!inspected.editable) {
        if (!this.state.readOnly) await this.queue?.flush();
        this.assertOpen(epoch);
        this.installBackend(
          decodeProjectFile({ revision: 0, project: { id: "prj_unsupported", name: file.name } }),
          { lock: null, original },
          { warnings: [inspected.reason] },
        );
        return;
      }
      const candidate = inspected.file;
      this.assertOpen(epoch);
      new ProjectCoordinator(candidate).getSnapshot();
      if (!this.state.readOnly) await this.queue?.flush();
      this.assertOpen(epoch);
      const same = candidate.project.id === this.state.project.id;
      const currentBackend = this.open?.backend;
      if (!same) candidateRelease = await acquireProjectWriter(candidate.project.id);
      this.assertOpen(epoch);
      await this.store.importProject(candidate);
      const latest = (await this.store.load(candidate.project.id)) ?? candidate;
      this.assertOpen(epoch);
      // The same project keeps its lock; a different one swaps it for the candidate's.
      const lock = same
        ? currentBackend?.kind === "browserWriter"
          ? currentBackend.release
          : null
        : candidateRelease;
      candidateRelease = null;
      this.installBackend(latest, { lock }, {}, { keepLock: same });
      await this.refreshMedia();
      this.update({ warnings });
    } catch (error) {
      candidateRelease?.();
      throw error;
    } finally {
      this.finish(operation);
    }
  }

  async createProject() {
    this.assertWritable();
    const json = encodeProjectFile(standardProject(`prj_${crypto.randomUUID()}`));
    await this.openProject(new File([json], "Untitled.tandem", { type: "application/json" }));
  }
  downloadProject(version = false) {
    const original = this.unsupportedOriginal;
    const json = original ?? encodeProjectFile(this.projectFile());
    // Run the same full validator used for editing before exporting a project.
    const validated = original
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
        generation: this.host?.generation ?? 0,
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
    const operation = this.begin("archive", { clearError: true });
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
      this.finish(operation);
    }
  }

  async relinkMedia(mediaID: string, file: File) {
    this.assertWritable();
    if (!this.store) throw new Error("Storage is closed.");
    const original = this.state.project.media.find((m) => m.id === mediaID);
    if (!original) throw new Error("Source no longer exists in this project.");
    const epoch = this.epoch,
      revision = this.state.revision;
    const operation = this.begin("relink", { clearError: true });
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
      this.finish(operation);
    }
  }

  async importLUT(file: File): Promise<string> {
    this.assertWritable();
    if (!this.store) throw new Error("Browser storage is closed.");
    const epoch = this.epoch,
      projectID = this.state.project.id;
    const operation = this.begin("resource", { clearError: true });
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
      this.finish(operation);
    }
  }

  /** Returns the media ID of each file, in order; files already in the project keep their ID. */
  async importFiles(files: readonly File[]): Promise<string[]> {
    this.assertWritable();
    if (!this.store || !files.length) return [];
    const ids: string[] = [];
    const epoch = this.epoch;
    const operation = this.begin("import", { clearError: true });
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
          ids.push(existingID);
          continue;
        }
        await this.store.putResource(this.state.project.id, item.id, resource);
        commands.push({ addMedia: { item } });
        known.set(key, item.id);
        ids.push(item.id);
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
      return ids;
    } finally {
      this.finish(operation);
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
    const operation = this.begin("segment");
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
      this.finish(operation);
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
    const operation = this.begin("segment");
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
      this.finish(operation);
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
    const discardRecording = this.recording.close().catch(() => {});
    this.exports.stop();
    this.jobs.cancelAll();
    this.analysis.reset();
    // Invalidate the epoch before awaiting anything; older work and a later start cannot be
    // affected by this close draining the resources captured below.
    const requested = this.transition({ type: "closeRequested" });
    const epoch = this.epoch;
    requested.abort?.abort();
    const retired = this.retireBackend(requested);
    this.publish();
    const persistence = await (retired ?? this.draining);
    this.transition({ type: "closed", epoch, ...(persistence ? { persistence } : {}) });
    if (epoch === this.epoch) this.publish();
    await discardRecording;
  }
}
