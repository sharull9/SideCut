import { Schema } from "effect";
import { decodeProjectFile } from "./project";

export const DeliveryRecipeSchema = Schema.Struct({
  snapshotJSON: Schema.String,
  projectID: Schema.String,
  resources: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      fileID: Schema.String,
      name: Schema.String,
      type: Schema.String,
      lastModified: Schema.Finite,
      state: Schema.Literals(["available", "unsupported"]),
      detail: Schema.String,
    }),
  ),
  revision: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  resourceIDs: Schema.Array(Schema.String),
  format: Schema.NullOr(Schema.String),
  encoding: Schema.optionalKey(Schema.Literals(["webm", "h264", "hevc"])),
  preset: Schema.Literals(["webm", "review", "youtube1080", "short", "wav"]),
  startSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  durationSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
});
export const DeliverySchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
  name: Schema.String,
  recipe: DeliveryRecipeSchema,
  status: Schema.Literals(["queued", "running", "interrupted", "failed", "cancelled", "done"]),
  error: Schema.NullOr(Schema.String),
  outputFileID: Schema.NullOr(Schema.String),
  outputType: Schema.NullOr(Schema.String),
});
export type Delivery = typeof DeliverySchema.Type;
export const decodeDelivery = (input: unknown): Delivery => {
  const entry = Schema.decodeUnknownSync(DeliverySchema)(input);
  const file = decodeProjectFile(JSON.parse(entry.recipe.snapshotJSON));
  if (
    file.project.id !== entry.recipe.projectID ||
    file.revision !== entry.recipe.revision ||
    new Set(entry.recipe.resourceIDs).size !== entry.recipe.resourceIDs.length
  )
    throw new Error("Invalid delivery snapshot or resources.");
  return entry;
};
