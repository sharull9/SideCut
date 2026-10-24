import type { Asset } from "@sidecut/contracts/assets";
import type {
  ProviderInfo,
  ProviderQuery,
  GenerationRequest,
  ProviderFile,
} from "@sidecut/contracts/providers";
export type { ProviderInfo, ProviderQuery, GenerationRequest, ProviderFile };
export class ProviderError extends Error {
  permission?: string;
  constructor(
    readonly code:
      | "needsKey"
      | "unsupported"
      | "disabled"
      | "stub"
      | "permission"
      | "request"
      | "invalid"
      | "rateLimit",
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
export interface ProviderRequest {
  provider: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  auth?: boolean;
  signal: AbortSignal;
}
export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
  bytes: ArrayBuffer;
}
export interface ProviderEnvironment {
  mode: "browser" | "host";
  request: (request: ProviderRequest) => Promise<ProviderResponse>;
  hasCredential: (provider: string) => Promise<boolean>;
  localAssets?: (provider: string) => Promise<Asset[]>;
  localFiles?: (asset: Asset) => Promise<ProviderFile[]>;
  enabled?: (provider: string) => boolean;
  cacheGet?: (key: string) => Promise<{ expires: number; value: unknown } | undefined>;
  cachePut?: (key: string, value: { expires: number; value: unknown }) => Promise<void>;
  now?: () => number;
}
export interface FetchedAsset {
  asset: Asset;
  files: ProviderFile[];
}
export interface Provider {
  status?: () => Promise<ProviderInfo["status"]>;
  info: ProviderInfo;
  search: (query: ProviderQuery, signal: AbortSignal) => Promise<Asset[]>;
  fetch: (asset: Asset, signal: AbortSignal) => Promise<FetchedAsset>;
  similar?: (asset: Asset, limit: number, signal: AbortSignal) => Promise<Asset[]>;
  generate?: (
    request: GenerationRequest,
    signal: AbortSignal,
    save: (take: FetchedAsset) => Promise<void>,
  ) => Promise<{ takes: FetchedAsset[]; failures: string[] }>;
}
export function providerInfo(
  id: string,
  displayName: string,
  kinds: string[],
  rules: Partial<ProviderInfo["rules"]> = {},
  capabilities: Partial<ProviderInfo["capabilities"]> = {},
): ProviderInfo {
  return {
    id,
    displayName,
    kinds,
    status: { state: "ready" },
    capabilities: { search: true, similar: false, generate: false, ...capabilities },
    rules: { cacheTTL: 86400, notes: [], ...rules },
  };
}
export class ProviderHTTP {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private times: number[] = [];
  private active = 0;
  constructor(
    readonly env: ProviderEnvironment,
    readonly info: ProviderInfo,
  ) {}
  async status() {
    if (this.info.status.state === "stub") return this.info.status;
    if (this.info.id === "freesound" && !this.env.enabled?.("freesound"))
      return {
        state: "disabled" as const,
        message: "Freesound is disabled until its operator accepts the applicable API terms.",
      };
    if (["pixabay", "pexels", "freesound", "elevenlabs"].includes(this.info.id)) {
      if (this.env.mode === "browser")
        return {
          state: "unsupported" as const,
          message:
            "This provider needs the desktop credential transport. API keys are not stored in browser projects.",
        };
      if (!(await this.env.hasCredential(this.info.id)))
        return {
          state: "needsKey" as const,
          message: `Configure ${this.info.displayName} in desktop provider settings.`,
        };
    }
    return this.info.status;
  }
  async requireReady() {
    const status = await this.status();
    if (status.state !== "ready" && status.state !== "limited")
      throw new ProviderError(
        status.state as "needsKey" | "unsupported" | "disabled" | "stub",
        this.info.id,
        status.message ?? `${this.info.displayName} is unavailable.`,
      );
  }
  async response(
    url: string,
    signal: AbortSignal,
    method: "GET" | "POST" = "GET",
    body?: string,
    auth = false,
  ) {
    signal.throwIfAborted();
    const now = this.env.now?.() ?? Date.now(),
      r = this.info.rules;
    this.times = this.times.filter((t) => now - t < (r.window ?? 60) * 1000);
    if (
      (r.requestsPerWindow && this.times.length >= r.requestsPerWindow) ||
      this.active >= (r.maxConcurrentRequests ?? 4)
    )
      throw new ProviderError(
        "rateLimit",
        this.info.id,
        "Provider request limit reached. Retry later.",
      );
    if (new URL(url).protocol !== "https:")
      throw new ProviderError("invalid", this.info.id, "Provider URLs must use HTTPS.");
    this.times.push(now);
    this.active++;
    try {
      const response = await this.env.request({
        provider: this.info.id,
        url,
        method,
        ...(body ? { body } : {}),
        auth,
        signal,
      });
      signal.throwIfAborted();
      if (response.status < 200 || response.status >= 300) {
        const error = new ProviderError(
          response.status === 401 || response.status === 403 ? "permission" : "request",
          this.info.id,
          `${this.info.displayName} request failed (${response.status}). Check provider setup and retry.`,
        );
        if (error.code === "permission" && this.info.id === "elevenlabs") {
          try {
            const data = JSON.parse(new TextDecoder().decode(response.bytes));
            if (data?.detail?.status === "missing_permissions")
              error.permission = url.includes("sound-generation")
                ? "sound_generation"
                : "music_generation";
          } catch {
            /* The public error never includes a response body. */
          }
        }
        throw error;
      }
      if (response.bytes.byteLength > 64 * 1024 * 1024)
        throw new ProviderError("invalid", this.info.id, "Provider file exceeds 64 MiB.");
      return response;
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(
        "request",
        this.info.id,
        `${this.info.displayName} could not be reached. Check network access or browser CORS support.`,
      );
    } finally {
      this.active--;
    }
  }
  async json(url: string, signal: AbortSignal, auth = false): Promise<unknown> {
    signal.throwIfAborted();
    const key = `provider:${this.info.id}:${url}`,
      now = this.env.now?.() ?? Date.now();
    const cached = this.cache.get(key) ?? (await this.env.cacheGet?.(key));
    signal.throwIfAborted();
    if (cached && cached.expires > now) return cached.value;
    const response = await this.response(url, signal, "GET", undefined, auth);
    if (response.bytes.byteLength > 8 * 1024 * 1024)
      throw new ProviderError("invalid", this.info.id, "Provider index exceeds 8 MiB.");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(response.bytes));
    } catch {
      throw new ProviderError("invalid", this.info.id, "Provider returned invalid JSON.");
    }
    if (this.info.rules.cacheTTL > 0) {
      const entry = { expires: now + this.info.rules.cacheTTL * 1000, value };
      this.cache.set(key, entry);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
      await this.env.cachePut?.(key, entry);
    }
    return value;
  }
  async file(url: string, name: string, signal: AbortSignal, auth = false): Promise<ProviderFile> {
    const response = await this.response(url, signal, "GET", undefined, auth);
    return {
      name,
      type: response.headers["content-type"]?.split(";")[0] ?? "application/octet-stream",
      bytes: response.bytes,
    };
  }
}
export const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Provider returned an invalid object.");
  return v as Record<string, unknown>;
};
export const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Provider returned an invalid list.");
  return v;
};
export const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
export const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
export const list = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : typeof v === "string"
      ? [v]
      : [];
export const wants = (q: ProviderQuery, kind: Asset["kind"]) =>
  !q.kinds.length || q.kinds.includes(kind);
export const url = (base: string, params: Record<string, string | number>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.href;
};
export const title = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
export function page(assets: Asset[], q: ProviderQuery) {
  const words = q.text.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return assets
    .filter(
      (a) =>
        wants(q, a.kind) &&
        words.every((w) =>
          [a.name, ...a.tags, a.summary ?? ""].join(" ").toLowerCase().includes(w),
        ),
    )
    .slice((q.page - 1) * q.perPage, q.page * q.perPage);
}
