/**
 * Native recorder lifecycle. The persisted NativeRecording status (recording, stopping, ready,
 * error, interrupted) is a separate, durable contract and is not derived from these states.
 *
 * Service lifetime:  open -> closing -> closed
 * Journal recovery:  pending -> running -> done | failed (cached, as before)
 * Operation:         idle -> preparing -> starting -> recording -> stopping -> finalizing -> idle
 *                    recording -> finalizing (unexpected process exit) -> idle
 *                    idle -> operatingOnSaved -> idle
 *
 * A session's process handle belongs to the attempt that spawned it, so it exists only in the
 * states that need it. Every non-idle state is released by exactly one `release`, after the
 * owner finished its cleanup. Streaming target health stays inside the session and never
 * changes the operation state.
 */
export type Lifetime = "open" | "closing" | "closed";

export type Recovery =
  | { kind: "pending" }
  | { kind: "running"; ready: Promise<void> }
  | { kind: "done" }
  | { kind: "failed"; error: unknown };

export type Operation<Session, Proc> =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "starting"; session: Session; proc: Proc }
  | { kind: "recording"; session: Session; proc: Proc }
  | { kind: "stopping"; session: Session; proc: Proc }
  | { kind: "finalizing"; session: Session; cause: "stop" | "exit" }
  | { kind: "operatingOnSaved" };

export type OperationEvent<Session, Proc> =
  | { type: "prepare" }
  | { type: "operateSaved" }
  | { type: "spawned"; session: Session; proc: Proc }
  | { type: "ready"; session: Session }
  | { type: "stop" }
  | { type: "processEnded"; session: Session }
  | { type: "exited"; session: Session }
  | { type: "release" };

export class OperationRejected extends Error {}

export const busyMessage = "A recording operation is already active or closed";

/** Pure transition. Stale events return the same state; invalid public commands throw. */
export function operationTransition<Session, Proc>(
  state: Operation<Session, Proc>,
  event: OperationEvent<Session, Proc>,
): Operation<Session, Proc> {
  switch (event.type) {
    case "prepare":
      if (state.kind !== "idle") throw new OperationRejected(busyMessage);
      return { kind: "preparing" };
    case "operateSaved":
      if (state.kind !== "idle") throw new OperationRejected(busyMessage);
      return { kind: "operatingOnSaved" };
    case "spawned":
      if (state.kind !== "preparing")
        throw new OperationRejected("A process was spawned outside an owned start.");
      return { kind: "starting", session: event.session, proc: event.proc };
    case "ready":
      return state.kind === "starting" && state.session === event.session
        ? { kind: "recording", session: state.session, proc: state.proc }
        : state;
    case "stop":
      if (state.kind !== "recording") throw new OperationRejected("No active recording");
      return { kind: "stopping", session: state.session, proc: state.proc };
    case "processEnded":
      return state.kind === "stopping" && state.session === event.session
        ? { kind: "finalizing", session: state.session, cause: "stop" }
        : state;
    case "exited":
      return state.kind === "recording" && state.session === event.session
        ? { kind: "finalizing", session: state.session, cause: "exit" }
        : state;
    case "release":
      return { kind: "idle" };
  }
}

/** Operations that may be waited on during close; `recording` is stopped rather than awaited. */
export const operationSettling = (state: Operation<unknown, unknown>) =>
  state.kind !== "idle" && state.kind !== "recording";

export const operationSession = <S>(state: Operation<S, unknown>): S | undefined =>
  state.kind === "starting" ||
  state.kind === "recording" ||
  state.kind === "stopping" ||
  state.kind === "finalizing"
    ? state.session
    : undefined;
