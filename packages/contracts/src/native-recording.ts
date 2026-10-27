import { Schema } from "effect";

export type NativeRecordingRequest = {
  projectID: string;
  source: "screen" | "camera" | "microphone";
  deviceID?: string;
  microphoneID?: string;
  encoder: "auto" | "software";
};

export type NativeCaptureDevice = { id: string; name: string; kind: "camera" | "microphone" };

export type NativeRecordingAsset = {
  recording: NativeRecording;
  name: string;
  type: "video/mp4" | "audio/mp4";
  bytes: Uint8Array;
};

/** Wire metadata never contains host paths or executable arguments. */
export type NativeRecording = {
  id: string;
  projectID: string;
  source: NativeRecordingRequest["source"];
  createdAt: string;
  status: "recording" | "stopping" | "ready" | "interrupted" | "error";
  encoder: string;
  elapsedSeconds: number;
  bytes: number;
  tracks: { kind: "video" | "audio"; startSeconds: number; durationSeconds: number }[];
  error: string | null;
};

const nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const NativeRecordingSchema = Schema.Struct({
  id: Schema.String.check(
    Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  projectID: Schema.String,
  source: Schema.Literals(["screen", "camera", "microphone"]),
  createdAt: Schema.String,
  status: Schema.Literals(["recording", "stopping", "ready", "interrupted", "error"]),
  encoder: Schema.Literals(["aac", "libx264", "h264_nvenc", "h264_qsv", "h264_amf"]),
  elapsedSeconds: nonnegative,
  bytes: nonnegative.check(Schema.isInt()),
  tracks: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["video", "audio"]),
      startSeconds: Schema.Finite,
      durationSeconds: nonnegative,
    }),
  ),
  error: Schema.NullOr(Schema.String),
});

export const decodeNativeRecording = Schema.decodeUnknownSync(NativeRecordingSchema);

export interface NativeFileReference {
  id: string;
  name: string;
  type: string;
  bytes: number;
  lastModified: number;
}
