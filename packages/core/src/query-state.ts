import { Schema } from "effect";
import type { MediaItem } from "@sidecut/contracts/project";

const optionalText = Schema.optionalKey(Schema.String);
const state = Schema.Literals(["none", "queued", "running", "ready", "failed", "cancelled"]);
const progress = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
);
export const AnalysisStateSchema = Schema.Struct({
  state,
  progress: Schema.optionalKey(progress),
  message: optionalText,
});
export const QueryStateSchema = Schema.Struct({
  projectID: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  warnings: Schema.Array(Schema.String),
  jobs: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      mediaID: Schema.String,
      state,
      progress,
      message: optionalText,
    }),
  ),
  exports: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      output: Schema.String,
      preset: Schema.String,
      state: Schema.Literals(["running", "done", "failed"]),
      progress,
      message: optionalText,
    }),
  ),
  media: Schema.Record(
    Schema.String,
    Schema.Struct({
      exists: Schema.Boolean,
      analysis: Schema.Record(Schema.String, AnalysisStateSchema),
    }),
  ),
});
export const decodeQueryState = Schema.decodeUnknownSync(QueryStateSchema);
export type QueryState = typeof QueryStateSchema.Type;
export function analysisKinds(item: MediaItem) {
  return [
    ...(item.undecodableCodec ? ["converted"] : []),
    ...(item.hasVideo || item.kind === "image" ? ["thumbnails"] : []),
    ...(item.hasVideo && item.kind === "video" ? ["proxy"] : []),
    ...(item.hasAudio ? ["waveform", "loudness", "transcript"] : []),
    ...(item.role === "camera"
      ? [...(item.hasVideo ? ["matte"] : []), ...(item.hasAudio ? ["isolatedVoice"] : [])]
      : []),
  ];
}
export const analysisJobKinds: Readonly<Record<string, readonly string[]>> = {
  "Timeline samples": ["thumbnails", "waveform"],
  "Analyse cutout": ["matte"],
  "Generate proxy": ["proxy"],
  "Local transcription": ["transcript"],
};
