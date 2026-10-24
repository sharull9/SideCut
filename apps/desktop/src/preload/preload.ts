import { contextBridge, ipcRenderer } from "electron";
import { bridgeChannels, type DesktopAppInfo, type DesktopBridge } from "../shared/bridge.ts";

const bridge: DesktopBridge = {
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
