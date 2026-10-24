import { Schema } from "effect";
import { assetKinds } from "./assets.ts";
const optional = <S extends Schema.Constraint>(s: S) => Schema.optionalKey(Schema.NullOr(s));
const QuerySchema = Schema.Struct({
  text: optional(Schema.String),
  kinds: optional(Schema.Array(Schema.Literals(assetKinds))),
  page: optional(Schema.Int),
  perPage: optional(Schema.Int),
  minDuration: optional(Schema.Finite),
  maxDuration: optional(Schema.Finite),
});
const clean = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))
    : v;
export function decodeProviderQuery(value: unknown = {}) {
  const q = Schema.decodeUnknownSync(QuerySchema)(clean(value)),
    page = q.page ?? 1,
    perPage = q.perPage ?? 30;
  if (
    page < 1 ||
    page > 10000 ||
    perPage < 1 ||
    perPage > 999 ||
    (q.text?.length ?? 0) > 1000 ||
    (q.minDuration != null && q.minDuration < 0) ||
    (q.maxDuration != null && q.maxDuration < 0) ||
    (q.minDuration != null && q.maxDuration != null && q.minDuration > q.maxDuration)
  )
    throw new Error("Invalid provider pagination, text or duration range.");
  return { ...q, text: q.text ?? "", kinds: q.kinds ?? [], page, perPage };
}
export type ProviderQuery = ReturnType<typeof decodeProviderQuery>;
const GenerationSchema = Schema.Struct({
  kind: optional(Schema.Literals(["sfx", "music"])),
  prompt: Schema.String,
  duration: optional(Schema.Finite),
  loop: optional(Schema.Boolean),
  promptInfluence: optional(Schema.Finite),
  instrumental: optional(Schema.Boolean),
  variations: optional(Schema.Int),
  model: optional(Schema.String),
});
export function decodeGeneration(value: unknown) {
  const r = Schema.decodeUnknownSync(GenerationSchema)(clean(value)),
    kind = r.kind ?? "sfx",
    prompt = r.prompt.trim();
  if (!prompt || prompt.length > 16000)
    throw new Error("Generation needs a prompt of 1–16,000 characters.");
  if (
    r.duration != null &&
    (r.duration < (kind === "sfx" ? 0.5 : 3) || r.duration > (kind === "sfx" ? 30 : 600))
  )
    throw new Error(
      kind === "sfx" ? "Sound effects last 0.5–30 seconds." : "Music lasts 3–600 seconds.",
    );
  if (r.promptInfluence != null && (r.promptInfluence < 0 || r.promptInfluence > 1))
    throw new Error("Prompt influence must be 0–1.");
  return {
    ...r,
    kind,
    prompt,
    loop: r.loop ?? false,
    instrumental: r.instrumental ?? true,
    variations: Math.min(4, Math.max(1, r.variations ?? 1)),
  };
}
export type GenerationRequest = ReturnType<typeof decodeGeneration>;
export type ProviderState = "ready" | "needsKey" | "disabled" | "stub" | "limited" | "unsupported";
export interface ProviderInfo {
  id: string;
  displayName: string;
  kinds: string[];
  capabilities: { search: boolean; similar: boolean; generate: boolean };
  status: { state: ProviderState; message?: string };
  rules: {
    cacheTTL: number;
    requestsPerWindow?: number;
    window?: number;
    maxConcurrentRequests?: number;
    notes: string[];
  };
}
export interface ProviderFile {
  name: string;
  type: string;
  bytes: ArrayBuffer;
}
