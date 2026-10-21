import { Effect, Schema, SchemaTransformation } from "effect";
import { Time } from "./time";

export const SCHEMA_VERSION = 2;
const keep = <const F extends Schema.Struct.Fields>(fields: F) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);

function fallback<S extends Schema.Constraint>(schema: S, value: () => S["Type"]) {
  const nullable = Schema.NullOr(schema);
  const defaulted = nullable.pipe(
    Schema.decodeTo(
      Schema.toType(schema),
      SchemaTransformation.transform({
        decode: (input) => input ?? value(),
        encode: (input) => input,
      }),
    ),
  );
  return Schema.withDecodingDefaultTypeKey<typeof defaulted>(Effect.sync(value))(defaulted);
}

const positiveInt = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const nonnegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const optional = <S extends Schema.Constraint>(schema: S) =>
  Schema.optionalKey(Schema.NullOr(schema));
const id = (prefix: string) => () =>
  `${prefix}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

export const TimeSchema = Schema.Finite.check(
  Schema.makeFilter((seconds) => {
    try {
      Time.fromSeconds(seconds);
      return undefined;
    } catch {
      return "Time exceeds the supported signed 64-bit flick range.";
    }
  }),
).pipe(
  Schema.decodeTo(
    Schema.instanceOf(Time),
    SchemaTransformation.transform({
      decode: Time.fromSeconds,
      encode: (time) => time.toJSON(),
    }),
  ),
);

export const FrameRateSchema = keep({ numerator: positiveInt, denominator: positiveInt });
const OutputFormat = keep({
  id: Schema.String,
  name: Schema.String,
  width: positiveInt,
  height: positiveInt,
});

export const ProjectSettingsSchema = keep({
  width: fallback(positiveInt, () => 3840),
  height: fallback(positiveInt, () => 2160),
  frameRate: fallback(FrameRateSchema, () => ({ numerator: 30, denominator: 1 })),
  sampleRate: fallback(positiveInt, () => 48_000),
  loudnessTarget: fallback(Schema.Finite, () => -14),
  truePeakCeiling: fallback(Schema.Finite, () => -1),
  speechLoudness: fallback(Schema.Finite, () => -20),
  colorSpace: fallback(Schema.String, () => "rec709"),
  alternateFormats: fallback(Schema.Array(OutputFormat), () => []),
});

const ContentBody = Schema.Union([
  keep({ media: keep({ mediaID: Schema.String }) }),
  keep({ text: keep({ text: Schema.String }) }),
  keep({ graphic: keep({ template: Schema.String }) }),
  keep({ solid: Schema.JsonObject }),
  keep({ adjustment: Schema.JsonObject }),
]);

export const ClipContentSchema = Schema.JsonObject.check(
  Schema.makeFilter((value) => {
    const keys = Object.keys(value);
    return keys.length === 1 &&
      ["media", "text", "graphic", "solid", "adjustment"].includes(keys[0] ?? "")
      ? undefined
      : "Clip content needs exactly one supported variant: media, text, graphic, solid, adjustment.";
  }),
).pipe(Schema.decodeTo(ContentBody));

export const ClipSchema = keep({
  id: fallback(Schema.String, id("clip")),
  name: optional(Schema.String),
  content: ClipContentSchema,
  start: fallback(TimeSchema, () => new Time(0n)),
  duration: TimeSchema,
  sourceStart: fallback(TimeSchema, () => new Time(0n)),
  speed: fallback(Schema.Finite.check(Schema.isGreaterThan(0)), () => 1),
  freezeFrame: fallback(Schema.Boolean, () => false),
  holdEdges: optional(Schema.Boolean),
  enabled: fallback(Schema.Boolean, () => true),
  linkGroup: optional(Schema.String),
  video: optional(Schema.JsonObject),
  audio: optional(Schema.JsonObject),
  keyframes: fallback(Schema.Record(Schema.String, Schema.Array(Schema.JsonObject)), () => ({})),
  tags: fallback(Schema.Array(Schema.String), () => []),
});

const mediaFields = {
  id: fallback(Schema.String, id("med")),
  path: Schema.String,
  kind: fallback(Schema.Literals(["video", "audio", "image"]), () => "video" as const),
  role: fallback(
    Schema.Literals([
      "camera",
      "screen",
      "broll",
      "graphic",
      "sticker",
      "music",
      "sfx",
      "image",
      "other",
    ]),
    () => "other" as const,
  ),
  takeID: optional(Schema.String),
  takeOffset: optional(TimeSchema),
  duration: optional(TimeSchema),
  frameRate: optional(FrameRateSchema),
  width: optional(positiveInt),
  height: optional(positiveInt),
  hasVideo: optional(Schema.Boolean),
  hasAudio: optional(Schema.Boolean),
  hasAlpha: fallback(Schema.Boolean, () => false),
  variableFrameRate: fallback(Schema.Boolean, () => false),
  undecodableCodec: optional(Schema.String),
  fingerprint: optional(Schema.String),
  look: fallback(Schema.Array(Schema.JsonObject), () => []),
  livePhotoVideo: optional(Schema.String),
  pictureDelay: optional(TimeSchema),
  pictureDelayCorrected: optional(TimeSchema),
  transcribe: optional(Schema.Boolean),
};

export const MediaItemSchema = keep(mediaFields).pipe(
  Schema.decodeTo(
    Schema.toType(keep({ ...mediaFields, hasVideo: Schema.Boolean, hasAudio: Schema.Boolean })),
    SchemaTransformation.transform({
      decode: (media) => ({
        ...media,
        hasVideo: media.hasVideo ?? media.kind !== "audio",
        hasAudio: media.hasAudio ?? media.kind === "audio",
      }),
      encode: (media) => media,
    }),
  ),
);

const trackFields = {
  id: fallback(Schema.String, id("trk")),
  kind: Schema.Literals(["video", "audio"]),
  name: optional(Schema.String),
  clips: fallback(Schema.Array(ClipSchema), () => []),
  transitions: fallback(Schema.Array(Schema.JsonObject), () => []),
  muted: fallback(Schema.Boolean, () => false),
  solo: fallback(Schema.Boolean, () => false),
  locked: fallback(Schema.Boolean, () => false),
  hidden: fallback(Schema.Boolean, () => false),
  targeted: fallback(Schema.Boolean, () => true),
  rippleMode: fallback(Schema.Literals(["cut", "follow", "off"]), () => "cut" as const),
};

export const TrackSchema = keep(trackFields).pipe(
  Schema.decodeTo(
    Schema.toType(keep({ ...trackFields, name: Schema.String })),
    SchemaTransformation.transform({
      decode: (track) => ({
        ...track,
        name: track.name ?? (track.kind === "video" ? "Video" : "Audio"),
      }),
      encode: (track) => track,
    }),
  ),
);

export const ProjectSchema = keep({
  schemaVersion: fallback(Schema.Literal(SCHEMA_VERSION), () => 2 as const),
  id: fallback(Schema.String, id("prj")),
  name: fallback(Schema.String, () => "Untitled"),
  settings: fallback(ProjectSettingsSchema, () =>
    Schema.decodeUnknownSync(ProjectSettingsSchema)({}),
  ),
  media: fallback(Schema.Array(MediaItemSchema), () => []),
  videoTracks: fallback(Schema.Array(TrackSchema), () => []),
  audioTracks: fallback(Schema.Array(TrackSchema), () => []),
  markers: fallback(Schema.Array(Schema.JsonObject), () => []),
  metadata: fallback(Schema.Record(Schema.String, Schema.String), () => ({})),
});

export const ProjectFileSchema = keep({ revision: nonnegativeInt, project: ProjectSchema });
export type Project = typeof ProjectSchema.Type;
export type ProjectFile = typeof ProjectFileSchema.Type;
export type Clip = typeof ClipSchema.Type;
export type Track = typeof TrackSchema.Type;
export type MediaItem = typeof MediaItemSchema.Type;

export function decodeProjectFile(input: unknown): ProjectFile {
  const json = Schema.decodeUnknownSync(Schema.Json)(input);
  if (json && typeof json === "object" && "project" in json) {
    const project = json.project;
    if (
      project &&
      typeof project === "object" &&
      "schemaVersion" in project &&
      project.schemaVersion != null &&
      project.schemaVersion !== SCHEMA_VERSION
    ) {
      throw new Error(
        `Unsupported Tandem schema version ${String(project.schemaVersion)}. Supported version: 2. Legacy migration arrives in phase 046.`,
      );
    }
  }
  return Schema.decodeUnknownSync(ProjectFileSchema)(json);
}

export function encodeProjectFile(file: ProjectFile): string {
  const encoded = Schema.encodeSync(ProjectFileSchema)(file);
  return JSON.stringify(Schema.decodeUnknownSync(Schema.Json)(encoded), null, 2);
}
