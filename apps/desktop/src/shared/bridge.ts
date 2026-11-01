export const rendererScheme = "sidecut";
export const rendererHost = "app";
export const rendererOrigin = `${rendererScheme}://${rendererHost}`;

export const bridgeChannels = {
  supportReport: "sidecut:support-report",
  deliveryEncode: "sidecut:delivery-encode",
  deliveryCancel: "sidecut:delivery-cancel",
  nativeRecordingDevices: "sidecut:native-recording-devices",
  nativeRecordingStart: "sidecut:native-recording-start",
  nativeRecordingStop: "sidecut:native-recording-stop",
  nativeRecordingList: "sidecut:native-recording-list",
  nativeRecordingStreamStatus: "sidecut:native-recording-stream-status",
  nativeRecordingRetry: "sidecut:native-recording-retry",
  nativeRecordingPoster: "sidecut:native-recording-poster",
  nativeRecordingAdopt: "sidecut:native-recording-adopt",
  nativeRecordingRead: "sidecut:native-recording-read",
  nativeRecordingDelete: "sidecut:native-recording-delete",
  nativeRecordingReveal: "sidecut:native-recording-reveal",
  capturePrepare: "sidecut:capture-prepare",
  captureRelease: "sidecut:capture-release",
  recordingDirectory: "sidecut:recording-directory",
  recordingExport: "sidecut:recording-export",
  storageRequest: "sidecut:storage-request",
  storagePutFile: "sidecut:storage-put-file",
  storageGetFile: "sidecut:storage-get-file",
  storageFileBegin: "sidecut:storage-file-begin",
  storageFileAppend: "sidecut:storage-file-append",
  storageFileSeal: "sidecut:storage-file-seal",
  storageFileAbort: "sidecut:storage-file-abort",
  storageFileSize: "sidecut:storage-file-size",
  storageFileRead: "sidecut:storage-file-read",
  storageFileDigest: "sidecut:storage-file-digest",
  storageRemoveFile: "sidecut:storage-remove-file",
  serviceReady: "sidecut:service-ready",
  serviceProgress: "sidecut:service-progress",
  serviceJobs: "sidecut:service-jobs",
  serviceRequest: "sidecut:service-request",
  serviceReply: "sidecut:service-reply",
  appInfo: "sidecut:app-info",
  projectRequest: "sidecut:project-request",
  projectResource: "sidecut:project-resource",
  projectChanged: "sidecut:project-changed",
  projectFlush: "sidecut:project-flush",
  projectImport: "sidecut:project-import",
  projectReload: "sidecut:project-reload",
  folderSelect: "sidecut:folder-select",
  folderChanged: "sidecut:folder-changed",
  nativeMedia: "sidecut:native-media",
  nativeCancel: "sidecut:native-cancel",
  nativeProgress: "sidecut:native-progress",
  providerCall: "sidecut:provider-call",
  providerCancel: "sidecut:provider-cancel",
  providerCredential: "sidecut:provider-credential",
} as const;

export type DesktopAppInfo = {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly versions: { readonly electron: string; readonly chrome: string };
};

export type DesktopBridge = NativeBridge & {
  readonly getAppInfo: () => Promise<DesktopAppInfo>;
  readonly providerCall: (requestID: string, request: unknown) => Promise<unknown>;
  readonly providerCancel: (requestID: string) => Promise<void>;
  readonly providerCredential: (
    provider: string,
    action: "set" | "clear",
    secret?: string,
  ) => Promise<void>;
};
import type { NativeBridge } from "@sidecut/contracts/desktop";
