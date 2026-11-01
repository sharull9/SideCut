import { contextBridge, ipcRenderer } from "electron";
import { bridgeChannels, type DesktopAppInfo, type DesktopBridge } from "../shared/bridge.ts";

const bridge: DesktopBridge = {
  supportReport: () => ipcRenderer.invoke(bridgeChannels.supportReport),
  deliveryEncode: (requestID, inputID, request) =>
    ipcRenderer.invoke(bridgeChannels.deliveryEncode, requestID, inputID, request),
  deliveryCancel: (requestID) => ipcRenderer.invoke(bridgeChannels.deliveryCancel, requestID),
  nativeRecordingDevices: () => ipcRenderer.invoke(bridgeChannels.nativeRecordingDevices),
  nativeRecordingStart: (request) =>
    ipcRenderer.invoke(bridgeChannels.nativeRecordingStart, request),
  nativeRecordingStop: () => ipcRenderer.invoke(bridgeChannels.nativeRecordingStop),
  nativeRecordingList: () => ipcRenderer.invoke(bridgeChannels.nativeRecordingList),
  nativeRecordingStreamStatus: () => ipcRenderer.invoke(bridgeChannels.nativeRecordingStreamStatus),
  nativeRecordingRetry: (id) => ipcRenderer.invoke(bridgeChannels.nativeRecordingRetry, id),
  nativeRecordingPoster: (id) => ipcRenderer.invoke(bridgeChannels.nativeRecordingPoster, id),
  nativeRecordingAdopt: (id) => ipcRenderer.invoke(bridgeChannels.nativeRecordingAdopt, id),
  nativeRecordingRead: (id) => ipcRenderer.invoke(bridgeChannels.nativeRecordingRead, id),
  nativeRecordingDelete: (id) => ipcRenderer.invoke(bridgeChannels.nativeRecordingDelete, id),
  nativeRecordingReveal: (id) => ipcRenderer.invoke(bridgeChannels.nativeRecordingReveal, id),
  capturePrepare: (id, request) => ipcRenderer.invoke(bridgeChannels.capturePrepare, id, request),
  captureRelease: (id) => ipcRenderer.invoke(bridgeChannels.captureRelease, id),
  recordingDirectory: () => ipcRenderer.invoke(bridgeChannels.recordingDirectory),
  recordingExport: (id) => ipcRenderer.invoke(bridgeChannels.recordingExport, id),
  storageRequest: (request) => ipcRenderer.invoke(bridgeChannels.storageRequest, request),
  storagePutFile: (bytes) => ipcRenderer.invoke(bridgeChannels.storagePutFile, bytes),
  storageGetFile: (id) => ipcRenderer.invoke(bridgeChannels.storageGetFile, id),
  storageFileBegin: () => ipcRenderer.invoke(bridgeChannels.storageFileBegin),
  storageFileAppend: (id, bytes) => ipcRenderer.invoke(bridgeChannels.storageFileAppend, id, bytes),
  storageFileSeal: (id) => ipcRenderer.invoke(bridgeChannels.storageFileSeal, id),
  storageFileAbort: (id) => ipcRenderer.invoke(bridgeChannels.storageFileAbort, id),
  storageFileSize: (id) => ipcRenderer.invoke(bridgeChannels.storageFileSize, id),
  storageFileRead: (id, offset, length) =>
    ipcRenderer.invoke(bridgeChannels.storageFileRead, id, offset, length),
  storageFileDigest: (id) => ipcRenderer.invoke(bridgeChannels.storageFileDigest, id),
  storageRemoveFile: (id) => ipcRenderer.invoke(bridgeChannels.storageRemoveFile, id),
  serviceSubscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, request: Parameters<typeof listener>[0]) =>
      listener(request);
    ipcRenderer.on(bridgeChannels.serviceRequest, handler);
    void ipcRenderer.invoke(bridgeChannels.serviceReady, true);
    return () => {
      ipcRenderer.removeListener(bridgeChannels.serviceRequest, handler);
      void ipcRenderer.invoke(bridgeChannels.serviceReady, false);
    };
  },
  serviceReply: (id, result, error) =>
    ipcRenderer.invoke(bridgeChannels.serviceReply, id, result, error),
  serviceProgress: (id, progress) =>
    ipcRenderer.invoke(bridgeChannels.serviceProgress, id, progress),
  serviceJobs: (jobs) => ipcRenderer.invoke(bridgeChannels.serviceJobs, jobs),
  projectResource: (id) => ipcRenderer.invoke(bridgeChannels.projectResource, id),
  // Only in-memory edits use sync IPC to preserve the editor's command result API.
  // Disk I/O and media jobs always use asynchronous channels.
  projectRequest: (json) => {
    const reply = ipcRenderer.sendSync(bridgeChannels.projectRequest, json) as {
      value?: ReturnType<DesktopBridge["projectRequest"]>;
      error?: string;
    };
    if (!reply.value) throw new Error(reply.error ?? "Host project request failed.");
    return reply.value;
  },
  projectSubscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value);
    ipcRenderer.on(bridgeChannels.projectChanged, handler);
    return () => {
      ipcRenderer.removeListener(bridgeChannels.projectChanged, handler);
    };
  },
  projectFlush: () => ipcRenderer.invoke(bridgeChannels.projectFlush),
  projectImport: (json) => ipcRenderer.invoke(bridgeChannels.projectImport, json),
  projectReload: (backup) => ipcRenderer.invoke(bridgeChannels.projectReload, backup),
  folderSelect: () => ipcRenderer.invoke(bridgeChannels.folderSelect),
  folderSubscribe: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      files: Parameters<typeof listener>[0],
      error: string | null,
    ) => listener(files, error);
    ipcRenderer.on(bridgeChannels.folderChanged, handler);
    return () => {
      ipcRenderer.removeListener(bridgeChannels.folderChanged, handler);
    };
  },
  nativeMedia: (id, operation, bytes, start, duration) =>
    ipcRenderer.invoke(bridgeChannels.nativeMedia, id, operation, bytes, start, duration),
  nativeCancel: (id) => ipcRenderer.invoke(bridgeChannels.nativeCancel, id),
  nativeProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, progress: number) =>
      listener(id, progress);
    ipcRenderer.on(bridgeChannels.nativeProgress, handler);
    return () => {
      ipcRenderer.removeListener(bridgeChannels.nativeProgress, handler);
    };
  },
  getAppInfo: () => ipcRenderer.invoke(bridgeChannels.appInfo) as Promise<DesktopAppInfo>,
  providerCall: (requestID, request) =>
    ipcRenderer.invoke(bridgeChannels.providerCall, requestID, request),
  providerCancel: (requestID) => ipcRenderer.invoke(bridgeChannels.providerCancel, requestID),
  providerCredential: (provider, action, secret) =>
    ipcRenderer.invoke(bridgeChannels.providerCredential, provider, action, secret),
};

contextBridge.exposeInMainWorld("sidecutDesktop", bridge);
