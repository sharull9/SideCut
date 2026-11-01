import { Schema } from "effect";

const identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9:_-]{1,100}$/));
const integer = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const intentSchema = Schema.Struct({
  deviceID: identifier,
  requestID: identifier,
  sequence: integer,
  expiresAt: integer,
  action: Schema.Literals(["status", "scene-switch", "recording-stop"]),
  id: Schema.String.check(Schema.isMaxLength(100)),
  revision: integer,
  studioRevision: integer,
});
const stateSchema = Schema.Struct({
  revision: integer,
  studioRevision: integer,
  activeSceneID: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  recording: Schema.NullOr(Schema.Struct({ id: identifier, status: identifier })),
});
export type RemoteIntent = typeof intentSchema.Type;
export const remoteIntent = (input: unknown) =>
  Schema.decodeUnknownSync(intentSchema, { onExcessProperty: "error" })(input);
export const remoteState = (input: unknown) =>
  Schema.decodeUnknownSync(stateSchema, { onExcessProperty: "error" })(input);
export function signedIntent(input: RemoteIntent) {
  const value = remoteIntent(input);
  return JSON.stringify([
    "sidecut-remote-v1",
    value.deviceID,
    value.requestID,
    value.sequence,
    value.expiresAt,
    value.action,
    value.id,
    value.revision,
    value.studioRevision,
  ]);
}
