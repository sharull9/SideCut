import type { FlagValue } from "./cli-foundation.mjs";
export function acquireProjectHost(
  flags: ReadonlyMap<string, FlagValue>,
  options?: { library?: boolean; signal?: AbortSignal },
): Promise<{
  endpoint: { port: number; token: string; pid?: number; headless?: boolean };
  project: string | undefined;
  close: () => Promise<void>;
}>;
