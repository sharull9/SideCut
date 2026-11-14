import type { ProjectCoordinator } from "@sidecut/core/coordinator";
import type { BrowserProjectStore } from "@sidecut/platform-browser/storage";
import type { SaveEvent, SaveQueue } from "@sidecut/platform-browser/save-queue";
import type { HostCoordinator } from "./host-coordinator";

/**
 * Lifecycle of one BrowserProjectSession.
 *
 *   opening --opened--> open --closeRequested--> closing --closed--> closed
 *   opening|open --openFailed--> failed;  any --start--> opening (new epoch)
 *
 * Within `open` the backend is explicit:
 *   browserWriter (lock + SaveQueue) | browserFollower | unsupported (original JSON) | nativeHost
 * and three orthogonal dimensions live beside it: persistence (saved/saving/error), the single
 * shared error slot with its source, and the foreground operation (token + owner).
 *
 * BrowserSnapshot.saveState/readOnly/busy/error/unsupportedJSON are derived from this state
 * (`deriveStatus`); nothing else sets them. The epoch changes whenever the session is
 * restarted, closed, or the host replaces the project, so older asynchronous work is stale.
 */
export type SaveStatus = "saving" | "saved" | "error";
export type OperationName =
  | "import"
  | "native-recording"
  | "folder"
  | "export"
  | "relink"
  | "archive"
  | "resource"
  | "segment"
  | "editing"
  | "replace";
export type ForegroundOperation = {
  token: number;
  name: OperationName;
  /** Cleanup owner: aborted when the session closes or the host replaces the project. */
  controller?: AbortController;
};
export type SessionError = {
  source: "save" | "host" | "operation" | "background";
  message: string;
};

export type BrowserWriter = {
  kind: "browserWriter";
  coordinator: ProjectCoordinator;
  release: () => void;
  queue: SaveQueue;
  unsubscribe: () => void;
};
export type BrowserFollower = {
  kind: "browserFollower";
  coordinator: ProjectCoordinator;
  unsubscribe: () => void;
};
export type UnsupportedProject = {
  kind: "unsupported";
  coordinator: ProjectCoordinator;
  original: string;
  unsubscribe: () => void;
};
export type NativeHost = {
  kind: "nativeHost";
  coordinator: HostCoordinator;
  generation: number;
  unsubscribe: () => void;
  folderStop: (() => void) | null;
};
export type Backend = BrowserWriter | BrowserFollower | UnsupportedProject | NativeHost;

/**
 * Identity-level persistence beside the saved/saving/error status: the newest revision known
 * to be durable (older saves count even while newer work is pending or failing) and the latest
 * save still outstanding. A native host snapshot carries its generation so a replaced project
 * restarts tracking.
 */
export type SaveTracking = {
  generation: number | null;
  lastSavedRevision: number | null;
  pending: { sequence: number; revision: number } | null;
};
export type SaveRecord = Pick<SaveEvent, "type" | "sequence" | "revision">;

export type OpenSession = {
  kind: "open";
  epoch: number;
  store: BrowserProjectStore;
  channel: BroadcastChannel | null;
  backend: Backend;
  persistence: SaveStatus;
  saves: SaveTracking;
  error: SessionError | null;
  operation: ForegroundOperation | null;
  nextToken: number;
};

export type Frozen = {
  saveState: "loading" | SaveStatus | "read-only";
  unsupportedJSON: string | null;
};

export type SessionState =
  | { kind: "opening"; epoch: number }
  | OpenSession
  | { kind: "closing"; epoch: number; frozen: Frozen }
  | { kind: "closed"; epoch: number; frozen: Frozen }
  | { kind: "failed"; epoch: number; error: string; frozen: Frozen };

export type SessionEvent =
  | { type: "start" }
  | {
      type: "opened";
      epoch: number;
      store: BrowserProjectStore;
      channel: BroadcastChannel | null;
      backend: Backend;
      persistence?: SaveStatus;
      savedRevision?: number;
    }
  | { type: "openFailed"; epoch: number; message: string }
  | { type: "backendInstalled"; epoch: number; backend: Backend; savedRevision?: number }
  | { type: "saveRecorded"; epoch: number; backend: Backend; save: SaveRecord }
  | { type: "persistence"; epoch: number; backend: Backend; status: SaveStatus; message?: string }
  | {
      type: "hostStatus";
      epoch: number;
      host: HostCoordinator;
      status: SaveStatus;
      message?: string;
      /** Host snapshot identity, when known: revision the status refers to, sequence, generation. */
      revision?: number;
      sequence?: number;
      generation?: number;
    }
  | { type: "errorRaised"; epoch: number; error: SessionError }
  | { type: "errorCleared"; epoch: number }
  | {
      type: "operationBegun";
      epoch: number;
      name: OperationName;
      clearError: boolean;
      controller?: AbortController;
    }
  | { type: "operationEnded"; epoch: number; token: number }
  | { type: "hostGenerationChanged"; epoch: number; generation: number }
  | { type: "closeRequested" }
  | { type: "closed"; epoch: number; persistence?: SaveStatus };

export type SessionStep = {
  state: SessionState;
  /** Resources the owner must dispose; the state no longer references them. */
  retired?: OpenSession | Backend;
  /** The token granted by `operationBegun`. */
  token?: number;
  /** Controllers the owner must abort because their operation was invalidated. */
  abort?: AbortController;
};

export class SessionCommandError extends Error {}

const frozenOf = (state: SessionState): Frozen => {
  const status = deriveStatus(state);
  return { saveState: status.saveState, unsupportedJSON: status.unsupportedJSON };
};

const freshSaves = (savedRevision?: number): SaveTracking => ({
  generation: null,
  lastSavedRevision: savedRevision ?? null,
  pending: null,
});

function hostSaves(
  saves: SaveTracking,
  event: Extract<SessionEvent, { type: "hostStatus" }>,
): SaveTracking {
  const { revision, generation, status } = event;
  if (revision === undefined || generation === undefined) return saves;
  // Snapshots from an older generation describe a replaced project.
  if (saves.generation !== null && generation < saves.generation) return saves;
  const base = saves.generation === generation ? saves : freshSaves();
  if (status === "saved") return { generation, lastSavedRevision: revision, pending: null };
  if (status === "saving")
    return {
      ...base,
      generation,
      pending: { sequence: event.sequence ?? (base.pending?.sequence ?? 0) + 1, revision },
    };
  return { ...base, generation };
}

/** Pure transition. Stale epochs and mismatched owners return the same state. */
export function sessionTransition(state: SessionState, event: SessionEvent): SessionStep {
  switch (event.type) {
    case "start":
      return {
        state: { kind: "opening", epoch: state.epoch + 1 },
        ...(state.kind === "open" ? { retired: state } : {}),
        ...(state.kind === "open" && state.operation?.controller
          ? { abort: state.operation.controller }
          : {}),
      };
    case "opened":
      if (state.kind !== "opening" || state.epoch !== event.epoch) return { state };
      return {
        state: {
          kind: "open",
          epoch: state.epoch,
          store: event.store,
          channel: event.channel,
          backend: event.backend,
          persistence: event.persistence ?? "saved",
          saves: freshSaves(event.savedRevision),
          error: null,
          operation: null,
          nextToken: 1,
        },
      };
    case "openFailed":
      if ((state.kind !== "opening" && state.kind !== "open") || state.epoch !== event.epoch)
        return { state };
      return {
        state: {
          kind: "failed",
          epoch: state.epoch,
          error: event.message,
          frozen: frozenOf(state),
        },
        ...(state.kind === "open" ? { retired: state } : {}),
        ...(state.kind === "open" && state.operation?.controller
          ? { abort: state.operation.controller }
          : {}),
      };
    case "backendInstalled": {
      if (state.kind !== "open" || state.epoch !== event.epoch) return { state };
      // A fresh backend starts clean: saved and without a leftover error.
      return {
        state: {
          ...state,
          backend: event.backend,
          persistence: "saved",
          saves: freshSaves(event.savedRevision),
          error: null,
        },
        retired: state.backend,
      };
    }
    case "persistence": {
      if (state.kind !== "open" || state.epoch !== event.epoch || state.backend !== event.backend)
        return { state };
      return {
        state: {
          ...state,
          persistence: event.status,
          error:
            event.status === "error" && event.message
              ? { source: "save", message: event.message }
              : null,
        },
      };
    }
    case "saveRecorded": {
      // Older queued saves that settle late still record durability; a stale backend never does.
      if (state.kind !== "open" || state.epoch !== event.epoch || state.backend !== event.backend)
        return { state };
      const { type, sequence, revision } = event.save;
      const saves = state.saves;
      if (type === "queued") {
        if (saves.pending && saves.pending.sequence >= sequence) return { state };
        return { state: { ...state, saves: { ...saves, pending: { sequence, revision } } } };
      }
      if (type === "failed") return { state };
      return {
        state: {
          ...state,
          saves: {
            ...saves,
            lastSavedRevision: Math.max(saves.lastSavedRevision ?? revision, revision),
            pending: saves.pending && saves.pending.sequence <= sequence ? null : saves.pending,
          },
        },
      };
    }
    case "hostStatus": {
      if (
        state.kind !== "open" ||
        state.epoch !== event.epoch ||
        state.backend.kind !== "nativeHost" ||
        state.backend.coordinator !== event.host
      )
        return { state };
      return {
        state: {
          ...state,
          persistence: event.status,
          saves: hostSaves(state.saves, event),
          error: event.message ? { source: "host", message: event.message } : null,
        },
      };
    }
    case "errorRaised":
      return state.kind === "open" && state.epoch === event.epoch
        ? { state: { ...state, error: event.error } }
        : { state };
    case "errorCleared":
      return state.kind === "open" && state.epoch === event.epoch && state.error
        ? { state: { ...state, error: null } }
        : { state };
    case "operationBegun": {
      if (state.kind !== "open" || state.epoch !== event.epoch)
        throw new SessionCommandError("The project session was closed.");
      if (state.operation)
        throw new SessionCommandError("Wait for the current file operation to finish.");
      const token = state.nextToken;
      return {
        state: {
          ...state,
          nextToken: token + 1,
          error: event.clearError ? null : state.error,
          operation: {
            token,
            name: event.name,
            ...(event.controller ? { controller: event.controller } : {}),
          },
        },
        token,
      };
    }
    case "operationEnded":
      // Only the owner of the current operation can clear it; stale completions are ignored.
      return state.kind === "open" &&
        state.epoch === event.epoch &&
        state.operation?.token === event.token
        ? { state: { ...state, operation: null } }
        : { state };
    case "hostGenerationChanged": {
      if (
        state.kind !== "open" ||
        state.epoch !== event.epoch ||
        state.backend.kind !== "nativeHost"
      )
        return { state };
      const controller = state.operation?.controller;
      return {
        state: {
          ...state,
          epoch: state.epoch + 1,
          operation: null,
          backend: { ...state.backend, generation: event.generation },
        },
        ...(controller ? { abort: controller } : {}),
      };
    }
    case "closeRequested": {
      if (state.kind === "closing" || state.kind === "closed") return { state };
      const frozen = frozenOf(state);
      return {
        state: { kind: "closing", epoch: state.epoch + 1, frozen },
        ...(state.kind === "open" ? { retired: state } : {}),
        ...(state.kind === "open" && state.operation?.controller
          ? { abort: state.operation.controller }
          : {}),
      };
    }
    case "closed":
      return state.kind === "closing" && state.epoch === event.epoch
        ? {
            state: {
              kind: "closed",
              epoch: state.epoch,
              frozen: {
                ...state.frozen,
                ...(event.persistence ? { saveState: event.persistence } : {}),
              },
            },
          }
        : { state };
  }
}

/** Last durable revision and the newest outstanding save of the open session. */
export function saveProgress(state: SessionState): SaveTracking | null {
  return state.kind === "open" ? state.saves : null;
}

export type CaptureStatus = "idle" | "requesting" | "recording" | "stopping" | "ready" | "error";
/** Why capture bound to a project is being re-evaluated. */
export type CaptureCause =
  | "ownership" // write access gained or lost
  | "backend" // the backend was replaced
  | "epoch" // the session restarted, closed, or the host replaced the project
  | "project" // the open document is a different project
  | "data"; // ordinary content change of the same project
export type CaptureAction = "none" | "discard" | "stop";

/**
 * Capture is bound to the project it started in and to write access. Losing either ends it:
 * a pending request is discarded, a running recording is stopped. Ordinary data changes of the
 * same project never end capture.
 */
export function captureTransition(input: {
  cause: CaptureCause;
  readOnly: boolean;
  projectID: string;
  boundProjectID: string | null;
  status: CaptureStatus;
}): CaptureAction {
  const lost =
    input.cause === "data"
      ? input.projectID !== input.boundProjectID
      : input.readOnly || input.projectID !== input.boundProjectID;
  if (!lost) return "none";
  if (input.status === "requesting") return "discard";
  if (input.status === "recording") return "stop";
  return "none";
}

export type DerivedStatus = {
  saveState: "loading" | "saving" | "saved" | "error" | "read-only";
  readOnly: boolean;
  busy: boolean;
  error: string | null;
  unsupportedJSON: string | null;
};

/** The legacy BrowserSnapshot lifecycle fields, computed from the authoritative state. */
export function deriveStatus(state: SessionState): DerivedStatus {
  switch (state.kind) {
    case "opening":
      return {
        saveState: "loading",
        readOnly: true,
        busy: false,
        error: null,
        unsupportedJSON: null,
      };
    case "failed":
      return {
        saveState: "error",
        readOnly: true,
        busy: false,
        error: state.error,
        unsupportedJSON: state.frozen.unsupportedJSON,
      };
    case "closing":
    case "closed":
      return {
        saveState: state.frozen.saveState,
        readOnly: true,
        busy: false,
        error: null,
        unsupportedJSON: state.frozen.unsupportedJSON,
      };
    case "open": {
      const writable =
        state.backend.kind === "browserWriter" || state.backend.kind === "nativeHost";
      return {
        saveState: writable ? state.persistence : "read-only",
        readOnly: !writable,
        busy: state.operation !== null,
        error: state.error?.message ?? null,
        unsupportedJSON: state.backend.kind === "unsupported" ? state.backend.original : null,
      };
    }
  }
}
