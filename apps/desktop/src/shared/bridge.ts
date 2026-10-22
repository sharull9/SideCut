export const rendererScheme = "sidecut";
export const rendererHost = "app";
export const rendererOrigin = `${rendererScheme}://${rendererHost}`;

export const bridgeChannels = { appInfo: "sidecut:app-info" } as const;

export type DesktopAppInfo = {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly versions: { readonly electron: string; readonly chrome: string };
};

export type DesktopBridge = {
  readonly getAppInfo: () => Promise<DesktopAppInfo>;
};
