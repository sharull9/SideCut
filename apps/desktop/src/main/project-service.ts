import { ProjectCoordinator, EditError } from "@sidecut/core/coordinator";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { HostReply, HostSnapshot } from "@sidecut/contracts/desktop";
import type { NativeProjectStore } from "./project-store.ts";
import { clipChanges } from "@sidecut/core/service-edits";

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
  savedRevision = 0;
  private reviewedRevision = 0;
  private reviewCache: {
    revision: number;
    baseline: number;
    entries: {
      label: string;
      author: string;
      date?: string;
      clipIDs: string[];
      removals: number;
    }[];
  } | null = null;
  reviewPending() {
    const file = this.coordinator.projectFile();
    if (this.reviewedRevision === file.revision) return [];
    if (
      this.reviewCache?.revision === file.revision &&
      this.reviewCache.baseline === this.reviewedRevision
    )
      return this.reviewCache.entries;
    const entries: NonNullable<typeof this.reviewCache>["entries"] = [];
    const raw = file.sidecutJournal;
    if (raw && typeof raw === "object" && "base" in raw && typeof raw.base === "string") {
      const replay = new ProjectCoordinator(decodeProjectFile(JSON.parse(raw.base)));
      for (const entry of this.coordinator.journalEntries()) {
        const before = replay.projectFile();
        if (entry.kind === "edit") replay.apply(entry.batch);
        else replay[entry.kind]();
        if (
          entry.result.revision <= this.reviewedRevision ||
          ["human", "user"].includes(entry.result.author)
        )
          continue;
        const changes = clipChanges(before, replay.projectFile());
        entries.push({
          label: entry.result.label,
          author: entry.result.author,
          ...(entry.date ? { date: entry.date } : {}),
          clipIDs: changes.filter((c) => c.kind !== "removed").map((c) => c.id),
          removals: changes.filter((c) => c.kind === "removed").length,
        });
      }
    }
    const current = new Set(
      [...file.project.videoTracks, ...file.project.audioTracks].flatMap((t) =>
        t.clips.map((c) => c.id),
      ),
    );
    for (const entry of entries) entry.clipIDs = entry.clipIDs.filter((id) => current.has(id));
    this.reviewCache = { revision: file.revision, baseline: this.reviewedRevision, entries };
    return entries;
  }
  constructor(readonly store: NativeProjectStore) {}
  private restoreReviewBaseline() {
    const { project, revision } = this.coordinator.getSnapshot();
    const saved = this.store.reviewedRevision(project.id);
    this.reviewedRevision = saved <= revision ? saved : 0;
    this.reviewCache = null;
  }

  async start() {
    await this.store.acquire();
    try {
      this.coordinator = new ProjectCoordinator(await this.store.load(fresh));
      this.restoreReviewBaseline();
      await this.store.save(this.coordinator.projectFile());
      this.savedRevision = this.coordinator.getSnapshot().revision;
    } catch (error) {
      this.state = "error";
      this.error = `${error instanceof Error ? error.message : String(error)}. Recover the backup or reload the disk version.`;
    }
  }
  snapshot(): HostSnapshot {
    const state = this.coordinator.getSnapshot();
    return {
      reviewPendingCount: this.reviewPending().length,
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
  history(limit = 20) {
    return this.coordinator.history(limit);
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
    if (input.type === "markReviewed" && "revision" in input) {
      if (this.state !== "saved" || this.savedRevision !== this.coordinator.getSnapshot().revision)
        throw new Error("Wait for edits to finish saving before marking them reviewed.");
      if (input.revision !== this.coordinator.getSnapshot().revision)
        throw new EditError("stale-revision", "Project changed before marking edits reviewed.");
      this.store.markReviewed(this.coordinator.getSnapshot().project.id, input.revision);
      this.reviewedRevision = input.revision;
      this.publish();
      return { snapshot: this.snapshot(), result: null };
    }
    let result;
    if (input.type === "apply" && "batch" in input) result = this.coordinator.apply(input.batch);
    else if ((input.type === "undo" || input.type === "redo") && "revision" in input) {
      if (input.revision !== this.coordinator.getSnapshot().revision)
        throw new EditError("stale-revision", "Stale revision. Retry with the latest project.");
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
        this.savedRevision = file.revision;
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
  async replace(
    json?: string,
    backup = false,
    expected?: { generation: number; revision: number },
  ) {
    if (this.replacing) throw new Error("Project is being replaced.");
    this.replacing = true;
    try {
      await this.pending;
      if (
        expected &&
        (this.generation !== expected.generation ||
          this.coordinator.getSnapshot().revision !== expected.revision)
      )
        throw new EditError("stale-revision", "Project changed before replacement.");
      // Imports may not discard unsaved edits. Recovery is an explicit reload choice.
      if (json !== undefined && this.error) throw new Error(this.error);
      const file =
        json === undefined
          ? await this.store.load(fresh, backup)
          : decodeProjectFile(JSON.parse(json));
      const coordinator = new ProjectCoordinator(file);
      if (json !== undefined || backup) await this.store.save(coordinator.projectFile());
      this.coordinator = coordinator;
      this.reviewCache = null;
      this.restoreReviewBaseline();
      this.savedRevision = file.revision;
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
