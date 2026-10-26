import { Schema } from "effect";

const strings = Schema.Array(Schema.String);
const revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const result = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
export const StatusResultSchema = result({ revision, name: Schema.String, path: Schema.String });
export const ApplyResultSchema = result({
  revision,
  label: Schema.String,
  author: Schema.String,
  dryRun: Schema.Boolean,
  repeated: Schema.Boolean,
  duration: Schema.Finite,
  added: strings,
  changed: strings,
  removed: strings,
  createdIDs: strings,
  warnings: strings,
});
export const TimelineResultSchema = result({ revision, project: Schema.Unknown });
export const TimelineTextSchema = result({ revision, text: Schema.String });
export const WordSchema = result({
  text: Schema.String,
  start: Schema.Finite,
  end: Schema.Finite,
  clipID: Schema.optionalKey(Schema.String),
});
export const TranscriptResultSchema = result({
  revision,
  scope: Schema.Literals(["timeline", "clip", "media"]),
  timelineTimes: Schema.Boolean,
  words: Schema.Array(WordSchema),
  missing: Schema.Array(Schema.Unknown),
});
const HistoryEventSchema = result({
  seq: Schema.optionalKey(Schema.Int),
  kind: Schema.String,
  revision,
  label: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
});
export const HistoryResultSchema = result({
  revision,
  events: Schema.Array(HistoryEventSchema),
  edits: Schema.optionalKey(Schema.Array(HistoryEventSchema)),
});
export type ApplyResult = typeof ApplyResultSchema.Type;
export type Word = typeof WordSchema.Type;
export type StatusResult = typeof StatusResultSchema.Type;
export type TranscriptResult = typeof TranscriptResultSchema.Type;

export function readResult<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
  operation: string,
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch {
    throw new Error(`Invalid ${operation} response from the host.`);
  }
}
