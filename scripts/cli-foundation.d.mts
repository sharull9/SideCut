export type FlagValue = string | boolean | string[];
export function parseArguments(args: readonly string[]): {
  flags: Map<string, FlagValue>;
  words: string[];
};
export function findProject(
  path?: string,
  directory?: string,
  env?: Record<string, string | undefined>,
): Promise<string | undefined>;
export function defaultDiscoveryPath(
  env?: Record<string, string | undefined>,
  platform?: NodeJS.Platform,
): string;
export function discoverEndpoint(
  flags: ReadonlyMap<string, FlagValue>,
  env?: Record<string, string | undefined>,
  directory?: string,
): Promise<{
  endpoint: { port: number; token: string; pid?: number; headless?: boolean };
  project: string | undefined;
}>;
export function verifyProjectOwner(
  project: string | undefined,
  status: { path?: unknown },
): Promise<void>;
export function commandHelp(topic: string | undefined): string | undefined;
export function segmentText(
  operation: string,
  result: { segment?: unknown; [key: string]: unknown },
): string;
