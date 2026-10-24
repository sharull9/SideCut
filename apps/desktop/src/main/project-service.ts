import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { HostReply, HostSnapshot } from "@sidecut/contracts/desktop";
import type { NativeProjectStore } from "./project-store.ts";

const fresh = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: `prj_${crypto.randomUUID()}`,
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

export class HostProjectService {
  private coordinator = new ProjectCoordinator(fresh());
  private sequence = 0;
  private generation = 0;
  private state: HostSnapshot["saveState"] = "saved";
  private error: string | null = null;
  private pending: Promise<void> = Promise.resolve();
  private listeners = new Set<(snapshot: HostSnapshot) => void>();
  private replacing = false;
  constructor(readonly store: NativeProjectStore) {}

  async start() {
    await this.store.acquire();
    try {
      this.coordinator = new ProjectCoordinator(await this.store.load(fresh));
      await this.store.save(this.coordinator.projectFile());
    } catch (error) {
      this.state = "error";
      this.error = `${error instanceof Error ? error.message : String(error)}. Recover the backup or reload the disk version.`;
    }
  }
  snapshot(): HostSnapshot {
    const state = this.coordinator.getSnapshot();
    return {
      sequence: this.sequence,
      generation: this.generation,
      json: encodeProjectFile(this.coordinator.projectFile()),
      undoLabel: state.undoLabel,
      redoLabel: state.redoLabel,
      lastChange: state.lastChange,
      saveState: this.state,
      error: this.error,
    };
  }
  subscribe(listener: (snapshot: HostSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish() {
    this.sequence++;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
  request(json: unknown): HostReply {
    if (typeof json !== "string" || json.length > 20 * 1024 * 1024)
      throw new Error("Invalid project request.");
    const input: unknown = JSON.parse(json);
    if (!input || typeof input !== "object" || !("type" in input))
      throw new Error("Invalid project request.");
    if (input.type === "snapshot") return { snapshot: this.snapshot(), result: null };
    if (this.replacing || this.state === "error")
      throw new Error(this.error ?? "Project is being replaced.");
    if (
      !("projectID" in input) ||
      input.projectID !== this.coordinator.getSnapshot().project.id ||
      !("generation" in input) ||
      input.generation !== this.generation
    )
      throw new Error("Project was replaced. Refresh before editing.");
    let result;
    if (input.type === "apply" && "batch" in input) result = this.coordinator.apply(input.batch);
    else if ((input.type === "undo" || input.type === "redo") && "revision" in input) {
      if (input.revision !== this.coordinator.getSnapshot().revision)
        throw new Error("Stale revision. Retry with the latest project.");
      result = this.coordinator[input.type]();
    } else throw new Error("Unknown project operation.");
    this.enqueue();
    return { snapshot: this.snapshot(), result };
  }
  private enqueue() {
    const file = this.coordinator.projectFile();
    this.state = "saving";
    this.publish();
    this.pending = this.pending.then(async () => {
      if (this.state === "error") return;
      try {
        await this.store.save(file);
        if (file.revision === this.coordinator.getSnapshot().revision) this.state = "saved";
      } catch (error) {
        this.state = "error";
        this.error = error instanceof Error ? error.message : String(error);
      }
      this.publish();
    });
  }
  async flush() {
    await this.pending;
    if (this.error) throw new Error(this.error);
  }
  async replace(json?: string, backup = false) {
    if (this.replacing) throw new Error("Project is being replaced.");
    this.replacing = true;
    try {
      await this.pending;
      // Imports may not discard unsaved edits. Recovery is an explicit reload choice.
      if (json !== undefined && this.error) throw new Error(this.error);
      const file =
        json === undefined
          ? await this.store.load(fresh, backup)
          : decodeProjectFile(JSON.parse(json));
      const coordinator = new ProjectCoordinator(file);
      if (json !== undefined || backup) await this.store.save(coordinator.projectFile());
      this.coordinator = coordinator;
      this.generation++;
      this.error = null;
      this.state = "saved";
      this.publish();
      return this.snapshot();
    } finally {
      this.replacing = false;
    }
  }
  async close() {
    await this.pending;
    await this.store.close();
  }
}
