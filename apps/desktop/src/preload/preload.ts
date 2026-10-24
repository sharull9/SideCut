import { contextBridge, ipcRenderer } from "electron";
import { bridgeChannels, type DesktopAppInfo, type DesktopBridge } from "../shared/bridge.ts";

const bridge: DesktopBridge = {
  getAppInfo: () => ipcRenderer.invoke(bridgeChannels.appInfo) as Promise<DesktopAppInfo>,
  providerCall: (requestID, request) =>
    ipcRenderer.invoke(bridgeChannels.providerCall, requestID, request),
  providerCancel: (requestID) => ipcRenderer.invoke(bridgeChannels.providerCancel, requestID),
  providerCredential: (provider, action, secret) =>
    ipcRenderer.invoke(bridgeChannels.providerCredential, provider, action, secret),
};

contextBridge.exposeInMainWorld("sidecutDesktop", bridge);
