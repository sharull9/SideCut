import { Effect, Schema, SchemaTransformation } from "effect";
import { MediaItemSchema, ClipSchema, TimeSchema, KeyframeSchema } from "./project";

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
    addTransition: Schema.Struct({
      trackID: Schema.String,
      transition: Schema.JsonObject,
      sound: nullable(Schema.JsonObject),
    }),
  }),
  Schema.Struct({
    updateTransition: Schema.Struct({ transitionID: Schema.String, patch: Schema.JsonObject }),
  }),
  Schema.Struct({ removeTransition: Schema.Struct({ transitionID: Schema.String }) }),
  Schema.Struct({
    addEffect: Schema.Struct({
      clipID: Schema.String,
      effect: Schema.Struct({
        id: nullable(Schema.String),
        type: Schema.String,
        enabled: nullable(Schema.Boolean),
        params: nullable(Schema.JsonObject),
      }),
      index: nullable(index),
    }),
  }),
  Schema.Struct({
    updateEffect: Schema.Struct({
      clipID: Schema.String,
      effectID: Schema.String,
      patch: Schema.JsonObject,
    }),
  }),
  Schema.Struct({
    removeEffect: Schema.Struct({ clipID: Schema.String, effectID: Schema.String }),
  }),
  Schema.Struct({
    moveEffect: Schema.Struct({ clipID: Schema.String, effectID: Schema.String, index }),
  }),

  Schema.Struct({
    applyLayout: Schema.Struct({
      clipIDs: Schema.Array(Schema.String),
      preset: Schema.Literals(["full", "pipRight", "pipLeft", "split", "fill"]),
    }),
  }),
  Schema.Struct({
    zoomToRegion: Schema.Struct({
      clipID: Schema.String,
      rect: Schema.Struct({
        x: Schema.Finite,
        y: Schema.Finite,
        width: Schema.Finite,
        height: Schema.Finite,
      }),
      at: nullable(TimeSchema),
      duration: nullable(TimeSchema),
    }),
  }),
  Schema.Struct({
    setKeyframes: Schema.Struct({
      clipID: Schema.String,
      parameter: Schema.String,
      keyframes: Schema.Array(KeyframeSchema),
    }),
  }),
  Schema.Struct({
    addMotion: Schema.Struct({
      clipIDs: Schema.Array(Schema.String),
      style: Schema.Literals(["zoomIn", "zoomOut", "panLeft", "panRight", "panUp", "panDown"]),
      amount: nullable(Schema.Finite),
    }),
  }),

  Schema.Struct({
    showAngle: Schema.Struct({
      range: Schema.Struct({ start: TimeSchema, duration: TimeSchema }),
      trackID: Schema.String,
    }),
  }),
  Schema.Struct({ join: Schema.Struct({ clipID: Schema.String }) }),
  Schema.Struct({
    joinThroughEdits: Schema.Struct({
      range: nullable(Schema.Struct({ start: TimeSchema, duration: TimeSchema })),
    }),
  }),
  Schema.Struct({
    setSpeed: Schema.Struct({
      clipID: Schema.String,
      speed: Schema.Finite,
      ripple: nullable(Schema.Boolean),
      includeLinked: nullable(Schema.Boolean),
    }),
  }),
  Schema.Struct({
    holdFrame: Schema.Struct({
      clipID: Schema.String,
      range: Schema.Struct({ start: TimeSchema, duration: TimeSchema }),
    }),
  }),
  Schema.Struct({ updateClip: Schema.Struct({ clipID: Schema.String, patch: Schema.JsonObject }) }),
  Schema.Struct({
    placeMedia: Schema.Struct({
      mediaIDs: Schema.Array(Schema.String),
      at: TimeSchema,
      sourceStart: nullable(TimeSchema),
      duration: nullable(TimeSchema),
      mode: nullable(Schema.Literals(["place", "insert", "overwrite"])),
      videoTrackID: nullable(Schema.String),
      audioTrackID: nullable(Schema.String),
      includeAudio: nullable(Schema.Boolean),
      anchor: nullable(
        Schema.Literals([
          "centre",
          "top",
          "bottom",
          "topLeft",
          "topRight",
          "bottomLeft",
          "bottomRight",
          "lowerThird",
        ]),
      ),
      pop: nullable(Schema.Boolean),
      speed: nullable(Schema.Finite),
    }),
  }),
  Schema.Struct({
    placeSynced: Schema.Struct({ mediaID: Schema.String, trackID: nullable(Schema.String) }),
  }),
  Schema.Struct({
    cutRanges: Schema.Struct({
      ranges: Schema.Array(Schema.Struct({ start: TimeSchema, duration: TimeSchema })),
      trackIDs: nullable(Schema.Array(Schema.String)),
    }),
  }),
  Schema.Struct({ closeGap: Schema.Struct({ trackID: Schema.String, at: TimeSchema }) }),
  Schema.Struct({
    insertTime: Schema.Struct({
      at: TimeSchema,
      duration: TimeSchema,
      trackIDs: nullable(Schema.Array(Schema.String)),
    }),
  }),
  Schema.Struct({
    roll: Schema.Struct({
      leftClipID: Schema.String,
      rightClipID: Schema.String,
      delta: TimeSchema,
    }),
  }),
  Schema.Struct({
    slip: Schema.Struct({
      clipID: Schema.String,
      delta: TimeSchema,
      includeLinked: nullable(Schema.Boolean),
    }),
  }),
  Schema.Struct({ slide: Schema.Struct({ clipID: Schema.String, delta: TimeSchema }) }),
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
