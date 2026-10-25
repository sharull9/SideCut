import { decodeProjectFile } from "@sidecut/contracts/project";
import type { NativeBridge, HostSnapshot, HostRequest } from "@sidecut/contracts/desktop";
import type { CommitResult, JournalEntry, SessionSnapshot } from "@sidecut/core/coordinator";

export function nativeBridge(): NativeBridge | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { sidecutDesktop?: NativeBridge }).sidecutDesktop;
}

export class HostCoordinator {
  private wire: HostSnapshot;
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private stop: () => void;
  constructor(
    private readonly bridge: NativeBridge,
    private readonly status: (value: HostSnapshot) => void,
  ) {
    const initial = bridge.projectRequest(JSON.stringify({ type: "snapshot" })).snapshot;
    this.wire = initial;
    this.snapshot = this.decode(initial);
    this.stop = bridge.projectSubscribe((value) => this.receive(value));
    // Subscribe before fetching again so a concurrent window edit cannot be missed.
    this.receive(bridge.projectRequest(JSON.stringify({ type: "snapshot" })).snapshot);
  }
  private decode(value: HostSnapshot): SessionSnapshot {
    return {
      ...decodeProjectFile(JSON.parse(value.json)),
      undoLabel: value.undoLabel,
      redoLabel: value.redoLabel,
      lastChange: value.lastChange,
    };
  }
  receive(value: HostSnapshot) {
    if (value.sequence < this.wire.sequence) return;
    this.wire = value;
    this.snapshot = this.decode(value);
    this.status(value);
    for (const listener of this.listeners) listener();
  }
  getSnapshot = () => this.snapshot;
  get generation() {
    return this.wire.generation;
  }
  projectFile = () => decodeProjectFile(JSON.parse(this.wire.json));
  private journal: { json: string; entries: readonly JournalEntry[] | null } | null = null;
  /** The host's edit journal, or null when its snapshot carries none. */
  journalEntries(): readonly JournalEntry[] | null {
    if (this.journal?.json !== this.wire.json) {
      const raw = (JSON.parse(this.wire.json) as { sidecutJournal?: { entries?: unknown } })
        .sidecutJournal?.entries;
      this.journal = {
        json: this.wire.json,
        entries: Array.isArray(raw) ? (raw as JournalEntry[]) : null,
      };
    }
    return this.journal.entries;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private request(request: HostRequest): CommitResult | null {
    const reply = this.bridge.projectRequest(JSON.stringify(request));
    this.receive(reply.snapshot);
    return reply.result;
  }
  apply(input: unknown): CommitResult {
    const result = this.request({
      type: "apply",
      batch: input,
      projectID: this.snapshot.project.id,
      generation: this.wire.generation,
    });
    if (!result) throw new Error("Host returned no edit result.");
    return result;
  }
  undo() {
    return this.request({
      type: "undo",
      revision: this.snapshot.revision,
      projectID: this.snapshot.project.id,
      generation: this.wire.generation,
    });
  }
  redo() {
    return this.request({
      type: "redo",
      revision: this.snapshot.revision,
      projectID: this.snapshot.project.id,
      generation: this.wire.generation,
    });
  }
  close() {
    this.stop();
  }
}
