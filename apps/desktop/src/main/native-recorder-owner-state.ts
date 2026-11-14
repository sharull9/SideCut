/**
 * Which document may control the native recorder, independent of the recording's persisted status.
 *
 * (unowned) -> confirming -> starting -> active -> stopping -> (unowned)
 * confirming|starting --navigation/destroy--> invalidating -> (unowned)
 * active --navigation/destroy--> stopping
 *
 * `invalidating` means the request was revoked before a recording was published to this owner;
 * a late start completion must stop only the recording it created.
 */
export type OwnerState =
  | { kind: "confirming" }
  | { kind: "starting" }
  | { kind: "active"; id: string }
  | { kind: "stopping"; id: string }
  | { kind: "invalidating" };

export type OwnerEvent =
  | { type: "confirmed" }
  | { type: "started"; id: string }
  | { type: "invalidate" }
  | { type: "stop" }
  | { type: "finished" };

export type OwnerStep = {
  state: OwnerState | undefined;
  /** Effect for the caller: stop the recorder because the owner was revoked while recording. */
  stopRecorder?: true;
  /** Effect for the caller: a recording finished starting for a revoked owner; stop it. */
  stopLateStart?: true;
};

export class OwnerCommandError extends Error {}

/** Pure transition; `state: undefined` means the owner slot is released. */
export function ownerTransition(state: OwnerState, event: OwnerEvent): OwnerStep {
  switch (event.type) {
    case "confirmed":
      return { state: state.kind === "confirming" ? { kind: "starting" } : state };
    case "started":
      if (state.kind === "starting") return { state: { kind: "active", id: event.id } };
      if (state.kind === "invalidating") return { state, stopLateStart: true };
      throw new OwnerCommandError("A recording started outside an owned request.");
    case "invalidate":
      if (state.kind === "confirming" || state.kind === "starting")
        return { state: { kind: "invalidating" } };
      if (state.kind === "active")
        return { state: { kind: "stopping", id: state.id }, stopRecorder: true };
      return { state };
    case "stop":
      if (state.kind !== "active")
        throw new OwnerCommandError("No native recording owned by this document.");
      return { state: { kind: "stopping", id: state.id } };
    case "finished":
      return { state: undefined };
  }
}

export const ownerStarted = (state: OwnerState) =>
  state.kind === "active" || state.kind === "stopping";
export const ownerInvalid = (state: OwnerState) =>
  state.kind === "invalidating" || state.kind === "stopping";
