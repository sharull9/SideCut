import { Schema } from "effect";

export const Collection = Schema.Literals([
  "projects",
  "previous",
  "preferences",
  "resources",
  "assets",
  "segments",
  "cache",
  "migrations",
]);
const entry = Schema.Struct({
  collection: Collection,
  key: Schema.String,
  value: Schema.NullOr(Schema.String),
});
export const StorageRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("read"),
    collection: Collection,
    key: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("commit"),
    checks: Schema.Array(entry),
    writes: Schema.Array(entry),
  }),
]);
export type StorageRequest = typeof StorageRequestSchema.Type;
export type StorageCollection = typeof Collection.Type;
export const decodeStorageRequest = Schema.decodeUnknownSync(StorageRequestSchema);
export const decodeStorageRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })),
);
export type StorageRow = ReturnType<typeof decodeStorageRows>[number];
