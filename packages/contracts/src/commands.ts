import { Effect, Schema, SchemaTransformation } from "effect";
import { MediaItemSchema, ClipSchema, TimeSchema } from "./project";

const nullable = <S extends Schema.Constraint>(schema: S) =>
  Schema.optionalKey(Schema.NullOr(schema));
const index = Schema.Int.check(
  Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
);

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
  Schema.Struct({
    blade: Schema.Struct({
      at: TimeSchema,
      trackIDs: nullable(Schema.Array(Schema.String)),
      clipIDs: nullable(Schema.Array(Schema.String)),
    }),
  }),
  Schema.Struct({
    trim: Schema.Struct({
      clipID: Schema.String,
      edge: Schema.Literals(["start", "end"]),
      to: TimeSchema,
      ripple: nullable(Schema.Boolean),
      includeLinked: nullable(Schema.Boolean),
    }),
  }),
  Schema.Struct({
    moveClips: Schema.Struct({
      clipIDs: Schema.Array(Schema.String),
      delta: nullable(TimeSchema),
      toTrackID: nullable(Schema.String),
      includeLinked: nullable(Schema.Boolean),
      mode: nullable(Schema.Literals(["place", "overwrite"])),
    }),
  }),
  Schema.Struct({
    removeClips: Schema.Struct({
      clipIDs: Schema.Array(Schema.String),
      ripple: nullable(Schema.Boolean),
      includeLinked: nullable(Schema.Boolean),
    }),
  }),
  Schema.Struct({ link: Schema.Struct({ clipIDs: Schema.Array(Schema.String) }) }),
  Schema.Struct({ unlink: Schema.Struct({ clipIDs: Schema.Array(Schema.String) }) }),
  Schema.Struct({
    rippleDeleteRange: Schema.Struct({
      range: Schema.Struct({ start: TimeSchema, duration: TimeSchema }),
      trackIDs: nullable(Schema.Array(Schema.String)),
    }),
  }),
  Schema.Struct({ updateProject: Schema.Struct({ patch: Schema.JsonObject }) }),
  Schema.Struct({ updateSettings: Schema.Struct({ patch: Schema.JsonObject }) }),
  Schema.Struct({ addMedia: Schema.Struct({ item: MediaItemSchema }) }),
  Schema.Struct({
    updateMedia: Schema.Struct({ mediaID: Schema.String, patch: Schema.JsonObject }),
  }),
  Schema.Struct({ removeMedia: Schema.Struct({ mediaID: Schema.String }) }),
  Schema.Struct({
    addTrack: Schema.Struct({
      kind: Schema.Literals(["video", "audio"]),
      name: nullable(Schema.String),
      index: nullable(index),
      id: nullable(Schema.String),
    }),
  }),
  Schema.Struct({ removeTrack: Schema.Struct({ trackID: Schema.String }) }),
  Schema.Struct({ moveTrack: Schema.Struct({ trackID: Schema.String, index }) }),
  Schema.Struct({
    updateTrack: Schema.Struct({ trackID: Schema.String, patch: Schema.JsonObject }),
  }),
  Schema.Struct({
    insertClip: Schema.Struct({
      trackID: Schema.String,
      clip: ClipSchema,
      mode: nullable(Schema.Literals(["place", "overwrite", "insert"])),
    }),
  }),
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
