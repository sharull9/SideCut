export const rendererScheme = "sidecut";
export const rendererHost = "app";
export const rendererOrigin = `${rendererScheme}://${rendererHost}`;

export const bridgeChannels = {
  appInfo: "sidecut:app-info",
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

export type DesktopBridge = {
  readonly getAppInfo: () => Promise<DesktopAppInfo>;
  readonly providerCall: (requestID: string, request: unknown) => Promise<unknown>;
  readonly providerCancel: (requestID: string) => Promise<void>;
  readonly providerCredential: (
    provider: string,
    action: "set" | "clear",
    secret?: string,
  ) => Promise<void>;
};
