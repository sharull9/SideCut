import { expect, it } from "vite-plus/test";
import {
  jobTransition,
  queueTransition,
  type JobState,
  type QueueState,
} from "./export-queue-state";

const controller = () => new AbortController();
it("queue lifetime: lock handles are returned exactly once", () => {
  const release = () => {};
  let state: QueueState<string> = { kind: "unconfigured" };
  let step = queueTransition(state, { type: "configure", epoch: 1, options: "d", needsLock: true });
  expect(step.state.kind).toBe("acquiring");
  step = queueTransition(step.state, { type: "lockAcquired", epoch: 1, release });
  expect(step.state).toMatchObject({ kind: "recovering", release });
  expect(step.release).toBeUndefined();
  step = queueTransition(step.state, { type: "recovered", epoch: 1 });
  step = queueTransition(step.state, { type: "stop" });
  expect(step.state.kind).toBe("closing");
  step = queueTransition(step.state, { type: "drained" });
  expect(step.state).toEqual({ kind: "closed", durable: "d" });
  expect(step.release).toBe(release);
  state = step.state;
  expect(queueTransition(state, { type: "drained" }).release).toBeUndefined();
});

it("queue lifetime: a stale lock grant is handed back, and denial blocks", () => {
  const release = () => {};
  const closing = queueTransition(
    { kind: "acquiring", epoch: 1, options: "d", known: false },
    { type: "stop" },
  );
  expect(queueTransition(closing.state, { type: "lockAcquired", epoch: 1, release }).release).toBe(
    release,
  );
  expect(
    queueTransition(
      { kind: "acquiring", epoch: 2, options: "d", known: false },
      { type: "lockDenied", epoch: 2 },
    ).state,
  ).toEqual({ kind: "blocked" });
});

it("job lifetime: stale attempts are ignored and invalid live transitions throw", () => {
  const first = controller();
  const queued: JobState = { kind: "queued", attempt: 1, controller: first };
  const rendering = jobTransition(queued, { type: "pick", attempt: 1, immediate: true });
  expect(rendering.kind).toBe("rendering");
  expect(jobTransition(rendering, { type: "completed", attempt: 2, url: "u", bytes: 1 })).toBe(
    rendering,
  );
  expect(() => jobTransition(rendering, { type: "stored", attempt: 1, fileID: "f" })).toThrow();
  const cancelling = jobTransition(rendering, { type: "cancel" });
  expect(cancelling.kind).toBe("cancelling");
  const cancelled = jobTransition(cancelling, { type: "aborted", attempt: 1, interrupted: false });
  expect(cancelled).toEqual({ kind: "cancelled", attempt: 1 });
  expect(jobTransition(cancelled, { type: "completed", attempt: 1, url: "u", bytes: 1 })).toBe(
    cancelled,
  );
  const retried = jobTransition(cancelled, { type: "retry", attempt: 2, controller: controller() });
  expect(retried).toMatchObject({ kind: "queued", attempt: 2 });
  expect(jobTransition(retried, { type: "aborted", attempt: 1, interrupted: true })).toBe(retried);
});
