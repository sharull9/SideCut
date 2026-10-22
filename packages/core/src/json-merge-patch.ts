import type { Schema } from "effect";
type Json = typeof Schema.Json.Type;
type JsonObject = typeof Schema.JsonObject.Type;
function object(value: Json): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

// RFC 7396: null removes a key, objects merge recursively, other values replace.
export function mergePatch(current: Json, patch: Json): Json {
  const fields = object(patch);
  if (!fields) return patch;
  const result = new Map(Object.entries(object(current) ?? {}));
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) result.delete(key);
    else result.set(key, mergePatch(result.get(key) ?? null, value));
  }
  return Object.fromEntries(result);
}
