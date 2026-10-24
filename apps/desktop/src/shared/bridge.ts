export const rendererScheme = "sidecut";
export const rendererHost = "app";
export const rendererOrigin = `${rendererScheme}://${rendererHost}`;

export const bridgeChannels = {
  serviceReady: "sidecut:service-ready",
  serviceRequest: "sidecut:service-request",
  serviceReply: "sidecut:service-reply",
  appInfo: "sidecut:app-info",
  projectRequest: "sidecut:project-request",
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
