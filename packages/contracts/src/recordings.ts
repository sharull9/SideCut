import { Schema } from "effect";

const id = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
const count = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const RecordingEntrySchema = Schema.Struct({
  id,
  projectID: Schema.String,
  createdAt: Schema.String,
  type: Schema.Literals([
    "audio/webm;codecs=opus",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp8,opus",
  ]),
  status: Schema.Literals(["capturing", "ready", "interrupted"]),
  bytes: count,
  chunks: Schema.Array(Schema.Struct({ id, bytes: count })),
});
export type RecordingEntry = typeof RecordingEntrySchema.Type;
export const decodeRecording = Schema.decodeUnknownSync(RecordingEntrySchema);
export const recordingChunkLimit = 8 * 1024 * 1024;
export const recordingStorageLimit = 1024 ** 4;
export const recordingFilename = (entry: RecordingEntry) =>
  `Recording-${entry.id}${entry.status === "ready" ? "" : "-partial"}.webm`;
