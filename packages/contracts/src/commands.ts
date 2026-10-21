import { Effect, Schema, SchemaTransformation } from "effect";
import { MediaItemSchema } from "./project";

const defaultText = (value: string) =>
  Schema.NullOr(Schema.String).pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transform({
        decode: (input) => input ?? value,
        encode: (input) => input,
      }),
    ),
    Schema.withDecodingDefaultKey(Effect.succeed(value)),
  );

const CommandBody = Schema.Union([
  Schema.Struct({ updateProject: Schema.Struct({ patch: Schema.JsonObject }) }),
  Schema.Struct({ updateSettings: Schema.Struct({ patch: Schema.JsonObject }) }),
  Schema.Struct({ addMedia: Schema.Struct({ item: MediaItemSchema }) }),
  Schema.Struct({
    updateMedia: Schema.Struct({ mediaID: Schema.String, patch: Schema.JsonObject }),
  }),
  Schema.Struct({ removeMedia: Schema.Struct({ mediaID: Schema.String }) }),
]);

export const EditCommandSchema = Schema.JsonObject.check(
  Schema.makeFilter((value) =>
    Object.keys(value).length === 1
      ? undefined
      : "Each command must contain exactly one operation.",
  ),
).pipe(Schema.decodeTo(CommandBody));

export const EditBatchSchema = Schema.Struct({
  label: defaultText("Edit"),
  author: defaultText("user"),
  commands: Schema.Array(EditCommandSchema),
  expectedRevision: Schema.optionalKey(
    Schema.NullOr(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
      ),
    ),
  ),
  idempotencyKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type EditBatch = typeof EditBatchSchema.Type;
export type EditCommand = typeof EditCommandSchema.Type;
