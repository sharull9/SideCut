import type { NativeDeliveryRequest } from "./native-delivery.ts";
import type {
  NativeCaptureDevice,
  NativeFileReference,
  NativeRecording,
  NativeRecordingAsset,
  NativeRecordingRequest,
} from "./native-recording.ts";
interface CommitResult {
  readonly revision: number;
  readonly label: string;
  readonly author: string;
  readonly createdIDs: readonly string[];
  readonly warnings: readonly string[];
}

// Plain wire values only. Project times cross IPC through the project JSON codec.
export interface HostSnapshot {
  reviewPendingCount?: number;
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
  | {
      type: "undo" | "redo" | "markReviewed";
      revision: number;
      projectID: string;
      generation: number;
    };
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
  deliveryEncode?: (
    requestID: string,
    inputID: string,
    request: NativeDeliveryRequest,
  ) => Promise<NativeFileReference>;
  deliveryCancel?: (requestID: string) => Promise<void>;
  nativeRecordingDevices?: () => Promise<NativeCaptureDevice[]>;
  nativeRecordingStart?: (request: NativeRecordingRequest) => Promise<NativeRecording>;
  nativeRecordingStop?: () => Promise<NativeRecording>;
  nativeRecordingList?: () => Promise<NativeRecording[]>;
  nativeRecordingRetry?: (id: string) => Promise<NativeRecording>;
  nativeRecordingPoster?: (id: string) => Promise<string | null>;
  nativeRecordingAdopt?: (id: string) => Promise<NativeFileReference>;
  nativeRecordingRead?: (id: string) => Promise<NativeRecordingAsset>;
  nativeRecordingDelete?: (id: string) => Promise<void>;
  nativeRecordingReveal?: (id: string) => Promise<void>;
  capturePrepare?: (
    id: string,
    request: { source: "screen" | "camera" | "microphone"; microphone: boolean },
  ) => Promise<void>;
  captureRelease?: (id: string) => Promise<void>;
  recordingDirectory?: () => Promise<boolean>;
  recordingExport?: (id: string) => Promise<{ name: string; bytes: number }>;
  storageRequest?: (request: unknown) => Promise<unknown>;
  storagePutFile?: (bytes: Uint8Array) => Promise<string>;
  storageGetFile?: (id: string) => Promise<Uint8Array>;
  storageFileBegin?: () => Promise<string>;
  storageFileAppend?: (id: string, bytes: Uint8Array) => Promise<void>;
  storageFileSeal?: (id: string) => Promise<void>;
  storageFileAbort?: (id: string) => Promise<void>;
  storageFileSize?: (id: string) => Promise<number>;
  storageFileRead?: (id: string, offset: number, length: number) => Promise<Uint8Array>;
  storageFileDigest?: (id: string) => Promise<string>;
  storageRemoveFile?: (id: string) => Promise<void>;
  serviceSubscribe?: (listener: (request: RendererServiceRequest) => void) => () => void;
  serviceReply?: (id: string, result: unknown, error?: string) => Promise<void>;
  serviceProgress?: (id: string, progress: number) => Promise<void>;
  serviceJobs?: (jobs: unknown[]) => Promise<void>;
  projectRequest: (json: string) => HostReply;
  projectResource?: (mediaID: string) => Promise<{ bytes: Uint8Array; name: string } | null>;
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
