// Kept apart from assistant-panel.tsx so checking for the bridge doesn't load the eve client.
export type Connection =
  | { status: "ready"; baseUrl: string; token: string; provider: string; model: string }
  | { status: "needs-setup" }
  | { status: "unavailable"; message: string };

export type AssistantSettings = {
  provider: string | null;
  model: string | null;
  keys: string[];
};

export type AssistantBridge = {
  assistantConnect: () => Promise<Connection>;
  assistantSettings: () => Promise<AssistantSettings>;
  assistantConfigure: (settings: { provider: string; model: string }) => Promise<void>;
  providerCredential: (provider: string, action: "set" | "clear", secret?: string) => Promise<void>;
};

/** The Assistant tab exists only in the desktop app, where the agent runs beside the host. */
export function assistantBridge(): AssistantBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as unknown as { sidecutDesktop?: Partial<AssistantBridge> })
    .sidecutDesktop;
  return bridge?.assistantConnect &&
    bridge.assistantSettings &&
    bridge.assistantConfigure &&
    bridge.providerCredential
    ? (bridge as AssistantBridge)
    : undefined;
}
