interface CommitResult {
  readonly revision: number;
  readonly label: string;
  readonly author: string;
  readonly createdIDs: readonly string[];
  readonly warnings: readonly string[];
}

// Plain wire values only. Project times cross IPC through the project JSON codec.
export interface HostSnapshot {
  sequence: number;
  generation: number;
  json: string;
  undoLabel: string | null;
  redoLabel: string | null;
  lastChange: {
    readonly kind: "edit" | "undo" | "redo";
    readonly label: string;
    readonly author: string;
  } | null;
  saveState: "saving" | "saved" | "error";
  error: string | null;
}
export type HostRequest =
  | { type: "snapshot" }
  | { type: "apply"; batch: unknown; projectID: string; generation: number }
  | { type: "undo" | "redo"; revision: number; projectID: string; generation: number };
export interface HostReply {
  snapshot: HostSnapshot;
  result: CommitResult | null;
}
export interface FolderMedia {
  path: string;
  bytes: Uint8Array;
  modified: number;
  role: string;
  shortAudioFallback: boolean;
}
export interface NativeBridge {
  serviceSubscribe?: (listener: (request: RendererServiceRequest) => void) => () => void;
  serviceReply?: (id: string, result: unknown, error?: string) => Promise<void>;
  projectRequest: (json: string) => HostReply;
  projectSubscribe: (listener: (snapshot: HostSnapshot) => void) => () => void;
  projectFlush: () => Promise<void>;
  projectImport: (json: string) => Promise<HostSnapshot>;
  projectReload: (backup: boolean) => Promise<HostSnapshot>;
  folderSelect: () => Promise<void>;
  folderSubscribe: (listener: (files: FolderMedia[], error: string | null) => void) => () => void;
  nativeMedia: (
    id: string,
    operation: "probe" | "decode" | "export",
    bytes: Uint8Array,
    start?: number,
    duration?: number,
  ) => Promise<Uint8Array>;
  nativeCancel: (id: string) => Promise<void>;
  nativeProgress: (listener: (id: string, progress: number) => void) => () => void;
}
export type RendererServiceRequest =
  | { id: string; type: "cancel" }
  | {
      id: string;
      type: "call";
      operation: string;
      input: Record<string, unknown>;
      projectID: string;
      generation: number;
      revision: number;
    };
