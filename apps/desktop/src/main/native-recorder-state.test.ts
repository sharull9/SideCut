import { expect, it } from "vite-plus/test";
import { operationTransition, OperationRejected, type Operation } from "./native-recorder-state.ts";

type Op = Operation<object, object>;
const session = {};
const proc = {};
it("a process exit and a stop converge on one finalization; the loser is stale", () => {
  const recording: Op = { kind: "recording", session, proc };
  const stopping = operationTransition(recording, { type: "stop" });
  expect(stopping.kind).toBe("stopping");
  // Process exit reported by the unexpected-exit watcher after stop took over is stale.
  expect(operationTransition(stopping, { type: "exited", session })).toBe(stopping);
  expect(operationTransition(stopping, { type: "processEnded", session })).toMatchObject({
    kind: "finalizing",
    cause: "stop",
  });
  const exited = operationTransition(recording, { type: "exited", session });
  expect(exited).toMatchObject({ kind: "finalizing", cause: "exit" });
  expect(() => operationTransition(exited, { type: "stop" })).toThrow(OperationRejected);
});
it("only an idle recorder starts work, and only a recording stops", () => {
  const idle: Op = { kind: "idle" };
  const preparing = operationTransition(idle, { type: "prepare" });
  expect(() => operationTransition(preparing, { type: "prepare" })).toThrow(OperationRejected);
  expect(() => operationTransition(preparing, { type: "operateSaved" })).toThrow(OperationRejected);
  expect(() => operationTransition(preparing, { type: "stop" })).toThrow("No active recording");
  expect(operationTransition(preparing, { type: "release" })).toEqual(idle);
});
it("a stale ready event from another attempt does not start recording", () => {
  const starting: Op = { kind: "starting", session, proc };
  expect(operationTransition(starting, { type: "ready", session: {} })).toBe(starting);
});
