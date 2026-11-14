import { EditError } from "@sidecut/core/coordinator";
import { QueryError } from "@sidecut/core/project-queries";
import { rendererMutations } from "@sidecut/core/service-requests";

/**
 * Lifecycle of one request sent to the editor renderer.
 *
 * pending --reply|abort|deadline|destroyed|close--> settled
 * settled --anything--> settled (ignored)
 *
 * Service availability is a separate machine: open -> closing -> closed.
 */
export type ProjectPosition = { generation: number; revision: number };

export type RendererOutcome =
  | { kind: "resolve"; value: unknown }
  | { kind: "reject"; error: Error };

export type PendingRequest = {
  phase: "pending";
  sender: number;
  operation: string;
  captured: ProjectPosition;
};

export type SettledRequest = { phase: "settled"; outcome: RendererOutcome };

export type RequestState = PendingRequest | SettledRequest;

export type RequestEvent =
  | {
      type: "reply";
      sender: number;
      result: unknown;
      error?: string | undefined;
      current: ProjectPosition;
    }
  | { type: "abort" }
  | { type: "deadline" }
  | { type: "destroyed" }
  | { type: "failed"; error: Error }
  | { type: "close" };

export type ServiceState = "open" | "closing" | "closed";
export type ServiceEvent = "close" | "closed";

export const pendingRequest = (
  sender: number,
  operation: string,
  captured: ProjectPosition,
): PendingRequest => ({ phase: "pending", sender, operation, captured });

export const serviceTransition = (state: ServiceState, event: ServiceEvent): ServiceState => {
  if (event === "close") return state === "open" ? "closing" : state;
  return state === "closing" ? "closed" : state;
};

/** Operations whose reply stays valid even when the project revision moved on. */
export const revisionSensitive = (operation: string) =>
  !rendererMutations.has(operation) && operation !== "wait" && operation !== "transcribe";

const rejectWith = (error: Error): SettledRequest => ({
  phase: "settled",
  outcome: { kind: "reject", error },
});

const unavailable = (message: string) => rejectWith(new QueryError("unavailable", message));

/** Decodes the structured error string renderers send; older renderers send plain text. */
export const rendererReplyError = (error: string): Error => {
  let detail: { code?: unknown; message?: unknown } = {};
  try {
    const parsed: unknown = JSON.parse(error);
    if (parsed && typeof parsed === "object") detail = parsed;
  } catch {
    /* Older renderers return plain text. */
  }
  return detail.code === "staleRevision"
    ? new EditError(
        "stale-revision",
        typeof detail.message === "string" ? detail.message : "Stale project revision.",
      )
    : new QueryError(
        detail.code === "badRequest" ||
          detail.code === "notFound" ||
          detail.code === "notImplemented"
          ? detail.code
          : "unavailable",
        typeof detail.message === "string" ? detail.message : error,
      );
};

/** Pure transition: a settled request never changes, and a reply from another sender is ignored. */
export const requestTransition = (state: RequestState, event: RequestEvent): RequestState => {
  if (state.phase === "settled") return state;
  switch (event.type) {
    case "reply": {
      if (event.sender !== state.sender) return state;
      if (event.error) return rejectWith(rendererReplyError(event.error));
      if (
        event.current.generation !== state.captured.generation ||
        (revisionSensitive(state.operation) && event.current.revision !== state.captured.revision)
      )
        return unavailable("Project changed while the renderer operation was running.");
      return { phase: "settled", outcome: { kind: "resolve", value: event.result } };
    }
    case "abort":
    case "deadline":
      return unavailable("Renderer operation cancelled.");
    case "destroyed":
      return unavailable("Editor window closed.");
    case "failed":
      return rejectWith(event.error);
    case "close":
      return unavailable("Desktop service is closing.");
  }
};
