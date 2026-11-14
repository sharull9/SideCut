import { describe, expect, it, vi } from "vite-plus/test";
import {
  captureTransition,
  deriveStatus,
  saveProgress,
  sessionTransition,
  SessionCommandError,
  type Backend,
  type NativeHost as NativeHostBackend,
  type OpenSession,
  type SessionState,
} from "./project-session-state.ts";

const fake = <T>(value: object) => value as T;
const writer = (release = vi.fn()): Backend =>
  fake({ kind: "browserWriter", release, queue: {}, coordinator: {}, unsubscribe: vi.fn() });
const follower = (): Backend =>
  fake({ kind: "browserFollower", coordinator: {}, unsubscribe: vi.fn() });
const opened = (backend: Backend, epoch = 1): OpenSession => {
  const step = sessionTransition(
    { kind: "opening", epoch },
    { type: "opened", epoch, store: fake({}), channel: null, backend },
  );
  return step.state as OpenSession;
};

describe("browser session lifecycle", () => {
  it("only the current opening epoch can open; a stale start resolution is ignored", () => {
    const first = sessionTransition({ kind: "opening", epoch: 0 }, { type: "start" }).state;
    const second = sessionTransition(first, { type: "start" }).state;
    const stale = sessionTransition(second, {
      type: "opened",
      epoch: 1,
      store: fake({}),
      channel: null,
      backend: writer(),
    });
    expect(stale.state).toBe(second);
    expect(second).toMatchObject({ kind: "opening", epoch: 2 });
  });

  it("derives the legacy snapshot fields from lifecycle, backend and operation", () => {
    expect(deriveStatus({ kind: "opening", epoch: 1 })).toMatchObject({
      saveState: "loading",
      readOnly: true,
    });
    expect(deriveStatus(opened(writer()))).toMatchObject({
      saveState: "saved",
      readOnly: false,
      busy: false,
    });
    expect(deriveStatus(opened(follower()))).toMatchObject({
      saveState: "read-only",
      readOnly: true,
    });
    const unsupported = opened(fake({ kind: "unsupported", original: "{raw}", coordinator: {} }));
    expect(deriveStatus(unsupported)).toMatchObject({ readOnly: true, unsupportedJSON: "{raw}" });
    expect(
      deriveStatus({
        kind: "failed",
        epoch: 1,
        error: "boom",
        frozen: { saveState: "loading", unsupportedJSON: null },
      }),
    ).toMatchObject({
      saveState: "error",
      readOnly: true,
      error: "boom",
    });
  });

  it("two stale completions cannot clear a newer foreground operation", () => {
    let state: SessionState = opened(writer());
    const begin = () => {
      const step = sessionTransition(state, {
        type: "operationBegun",
        epoch: 1,
        name: "import",
        clearError: false,
      });
      state = step.state;
      return step.token!;
    };
    const first = begin();
    expect(() =>
      sessionTransition(state, {
        type: "operationBegun",
        epoch: 1,
        name: "export",
        clearError: false,
      }),
    ).toThrow(SessionCommandError);
    state = sessionTransition(state, { type: "operationEnded", epoch: 1, token: first }).state;
    const second = begin();
    for (let attempt = 0; attempt < 2; attempt++)
      state = sessionTransition(state, { type: "operationEnded", epoch: 1, token: first }).state;
    expect(deriveStatus(state).busy).toBe(true);
    state = sessionTransition(state, { type: "operationEnded", epoch: 2, token: second }).state;
    expect(deriveStatus(state).busy).toBe(true); // wrong epoch
    state = sessionTransition(state, { type: "operationEnded", epoch: 1, token: second }).state;
    expect(deriveStatus(state).busy).toBe(false);
  });

  it("close invalidates the epoch, hands back resources once, and aborts the owned operation", () => {
    const controller = new AbortController();
    let state: SessionState = opened(writer());
    state = sessionTransition(state, {
      type: "operationBegun",
      epoch: 1,
      name: "export",
      clearError: true,
      controller,
    }).state;
    const closing = sessionTransition(state, { type: "closeRequested" });
    expect(closing.state).toMatchObject({ kind: "closing", epoch: 2 });
    expect(closing.retired).toBe(state);
    expect(closing.abort).toBe(controller);
    expect(sessionTransition(closing.state, { type: "closeRequested" }).retired).toBeUndefined();
    // Completions of the old epoch no longer match anything.
    expect(
      sessionTransition(closing.state, { type: "operationEnded", epoch: 1, token: 1 }).state,
    ).toBe(closing.state);
    expect(sessionTransition(closing.state, { type: "closed", epoch: 1 }).state).toBe(
      closing.state,
    );
    expect(sessionTransition(closing.state, { type: "closed", epoch: 2 }).state.kind).toBe(
      "closed",
    );
  });

  it("persistence and the shared error slot follow the backend that reported them", () => {
    const backend = writer();
    const state = opened(backend);
    const saving = sessionTransition(state, {
      type: "persistence",
      epoch: 1,
      backend,
      status: "error",
      message: "Could not save",
    }).state;
    expect(deriveStatus(saving)).toMatchObject({ saveState: "error", error: "Could not save" });
    const ignored = sessionTransition(saving, {
      type: "persistence",
      epoch: 1,
      backend: writer(),
      status: "saved",
    });
    expect(ignored.state).toBe(saving);
    const saved = sessionTransition(saving, {
      type: "persistence",
      epoch: 1,
      backend,
      status: "saved",
    }).state;
    expect(deriveStatus(saved)).toMatchObject({ saveState: "saved", error: null });
  });

  it("replacing the backend retires the old one for disposal and starts clean", () => {
    const old = writer();
    const state = opened(old);
    const step = sessionTransition(state, {
      type: "backendInstalled",
      epoch: 1,
      backend: follower(),
    });
    expect(step.retired).toBe(old);
    expect(deriveStatus(step.state)).toMatchObject({ readOnly: true, saveState: "read-only" });
    expect(
      sessionTransition(step.state, { type: "backendInstalled", epoch: 9, backend: writer() })
        .state,
    ).toBe(step.state);
  });

  it("a host generation change advances the epoch and cancels the owned operation", () => {
    const controller = new AbortController();
    const host = fake<Backend>({
      kind: "nativeHost",
      generation: 1,
      coordinator: {},
      unsubscribe: vi.fn(),
      folderStop: null,
    });
    let state: SessionState = opened(host);
    state = sessionTransition(state, {
      type: "operationBegun",
      epoch: 1,
      name: "export",
      clearError: false,
      controller,
    }).state;
    const step = sessionTransition(state, {
      type: "hostGenerationChanged",
      epoch: 1,
      generation: 2,
    });
    expect(step.abort).toBe(controller);
    expect(step.state).toMatchObject({ kind: "open", epoch: 2, operation: null });
    expect(deriveStatus(step.state).busy).toBe(false);
    expect(
      sessionTransition(step.state, { type: "operationEnded", epoch: 1, token: 1 }).state,
    ).toBe(step.state);
  });

  it("a startup failure after install retires every owned resource", () => {
    const state = opened(writer());
    const step = sessionTransition(state, { type: "openFailed", epoch: 1, message: "late" });
    expect(step.state).toEqual({
      kind: "failed",
      epoch: 1,
      error: "late",
      frozen: { saveState: "saved", unsupportedJSON: null },
    });
    expect(step.retired).toBe(state);
  });

  describe("save identity", () => {
    const save = (backend: Backend, type: "queued" | "succeeded" | "failed", n: number) =>
      ({
        type: "saveRecorded",
        epoch: 1,
        backend,
        save: { type, sequence: n, revision: n },
      }) as const;
    const run = (state: SessionState, ...events: Parameters<typeof sessionTransition>[1][]) =>
      events.reduce((current, event) => sessionTransition(current, event).state, state);

    it("an older success counts while the newer save is pending or has failed", () => {
      const backend = writer();
      const state = run(
        opened(backend),
        save(backend, "queued", 1),
        save(backend, "queued", 2),
        save(backend, "succeeded", 1),
      );
      expect(saveProgress(state)).toEqual({
        generation: null,
        lastSavedRevision: 1,
        pending: { sequence: 2, revision: 2 },
      });
      const failed = run(state, save(backend, "failed", 2));
      expect(saveProgress(failed)).toMatchObject({
        lastSavedRevision: 1,
        pending: { sequence: 2 },
      });
      expect(saveProgress(run(failed, save(backend, "succeeded", 2)))).toMatchObject({
        lastSavedRevision: 2,
        pending: null,
      });
    });

    it("never moves the durable revision backwards or the pending identity to older work", () => {
      const backend = writer();
      const state = run(
        opened(backend),
        save(backend, "queued", 3),
        save(backend, "queued", 2),
        save(backend, "succeeded", 3),
        save(backend, "succeeded", 2),
      );
      expect(saveProgress(state)).toMatchObject({ lastSavedRevision: 3, pending: null });
    });

    it("ignores completions from a replaced backend or an older epoch", () => {
      const first = writer();
      const state = opened(first);
      const replaced = sessionTransition(state, {
        type: "backendInstalled",
        epoch: 1,
        backend: writer(),
        savedRevision: 5,
      }).state;
      expect(sessionTransition(replaced, save(first, "succeeded", 9)).state).toBe(replaced);
      expect(saveProgress(replaced)).toMatchObject({ lastSavedRevision: 5, pending: null });
      const next = sessionTransition(replaced, { type: "start" }).state;
      expect(sessionTransition(next, save(first, "queued", 10)).state).toBe(next);
    });

    it("follows native host snapshots and restarts tracking when the generation changes", () => {
      const host = fake<NativeHostBackend>({
        kind: "nativeHost",
        coordinator: {},
        generation: 1,
        unsubscribe: vi.fn(),
        folderStop: null,
      });
      const status = (
        state: SessionState,
        extra: {
          status: "saving" | "saved" | "error";
          revision: number;
          sequence: number;
          generation: number;
        },
      ) =>
        sessionTransition(state, {
          type: "hostStatus",
          epoch: 1,
          host: host.coordinator,
          ...extra,
        }).state;
      let state = status(opened(host), {
        status: "saving",
        revision: 4,
        sequence: 7,
        generation: 1,
      });
      expect(saveProgress(state)).toMatchObject({ pending: { sequence: 7, revision: 4 } });
      state = status(state, { status: "saved", revision: 4, sequence: 8, generation: 1 });
      expect(saveProgress(state)).toEqual({ generation: 1, lastSavedRevision: 4, pending: null });
      state = status(state, { status: "saving", revision: 1, sequence: 1, generation: 2 });
      expect(saveProgress(state)).toEqual({
        generation: 2,
        lastSavedRevision: null,
        pending: { sequence: 1, revision: 1 },
      });
      // A snapshot from the replaced project cannot overwrite the new generation's tracking.
      const stale = status(state, { status: "saved", revision: 9, sequence: 9, generation: 1 });
      expect(saveProgress(stale)).toEqual(saveProgress(state));
    });
  });

  describe("capture ownership", () => {
    const input = {
      cause: "ownership" as const,
      readOnly: false,
      projectID: "a",
      boundProjectID: "a" as string | null,
      status: "recording" as const,
    };
    it("stops a recording and discards a request when write access is lost", () => {
      expect(captureTransition({ ...input, readOnly: true })).toBe("stop");
      expect(captureTransition({ ...input, readOnly: true, status: "requesting" })).toBe("discard");
      expect(captureTransition({ ...input, readOnly: true, status: "ready" })).toBe("none");
    });
    it("ends capture bound to another project for backend, epoch and project changes", () => {
      for (const cause of ["backend", "epoch", "project", "data"] as const)
        expect(captureTransition({ ...input, cause, projectID: "b" })).toBe("stop");
    });
    it("leaves capture running for ordinary data changes and unchanged ownership", () => {
      expect(captureTransition({ ...input, cause: "data", readOnly: true })).toBe("none");
      expect(captureTransition(input)).toBe("none");
      expect(captureTransition({ ...input, boundProjectID: null })).toBe("stop");
    });
  });
});
