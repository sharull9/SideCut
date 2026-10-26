export type HostEndpoint = { port: number; token: string; pid?: number; headless?: boolean };
export function discoverHost(path?: string): Promise<HostEndpoint>;
export function hostCall(
  host: HostEndpoint,
  operation: string,
  input?: unknown,
  signal?: AbortSignal,
  author?: string,
): Promise<unknown>;
export function watchHost(
  host: HostEndpoint,
  options?: { signal?: AbortSignal; lastEventID?: number },
): AsyncGenerator<Record<string, unknown>>;
