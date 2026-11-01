import { Schema } from "effect";

const uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10000));
const seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const positiveSeconds = Schema.Finite.check(Schema.isGreaterThan(0));
const count = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const ReviewVersionSchema = Schema.Struct({
  id: uuid,
  projectID: text,
  sourceRevision: count,
  createdAt: text,
  createdBy: text,
  title: text,
  source: Schema.Struct({
    startSeconds: seconds,
    durationSeconds: positiveSeconds,
    snapshotJSON: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32 * 1024 * 1024)),
  }),
  artifact: Schema.Struct({
    fileID: uuid,
    name: text,
    type: Schema.Literals(["video/webm", "video/mp4", "audio/wav"]),
    bytes: count,
    sha256: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  }),
});
export const ReviewThreadSchema = Schema.Struct({
  id: uuid,
  versionID: uuid,
  anchor: Schema.Struct({
    versionStartSeconds: seconds,
    durationSeconds: seconds,
    sourceStartSeconds: seconds,
  }),
  author: text,
  body: text,
  createdAt: text,
  replies: Schema.Array(Schema.Struct({ id: uuid, author: text, body: text, createdAt: text })),
  resolvedAt: Schema.NullOr(text),
  resolvedBy: Schema.NullOr(text),
  revision: count,
});
export type ReviewVersion = typeof ReviewVersionSchema.Type;
export type ReviewThread = typeof ReviewThreadSchema.Type;
export const decodeReviewVersion = Schema.decodeUnknownSync(ReviewVersionSchema);
export const decodeReviewThread = Schema.decodeUnknownSync(ReviewThreadSchema);
