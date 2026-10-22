import { contextBridge, ipcRenderer } from "electron";
import { bridgeChannels, type DesktopAppInfo, type DesktopBridge } from "../shared/bridge.ts";

const bridge: DesktopBridge = {
  getAppInfo: () => ipcRenderer.invoke(bridgeChannels.appInfo) as Promise<DesktopAppInfo>,
};

contextBridge.exposeInMainWorld("sidecutDesktop", bridge);
