import type { BrowserProjectSession } from "./browser-session";
import { serviceRequest, rendererMutations } from "@sidecut/core/service-requests";
import { speechQuery, helperPlan } from "@sidecut/core/service-speech";
import { transcribeService } from "./service-transcribe";
import { QueryError } from "@sidecut/core/project-queries";

export async function rendererOperation(
  session: BrowserProjectSession,
  operation: string,
  input: unknown,
  signal: AbortSignal,
) {
  if (operation === "query-state" || operation === "timeline") {
    const { rendererQuery } = await import("./service-queries");
    return rendererQuery(session, operation, input, signal);
  }
  if (operation === "check-state") {
    if (
      !input ||
      typeof input !== "object" ||
      !("request" in input) ||
      !("ranges" in input) ||
      !Array.isArray(input.ranges) ||
      !input.ranges.every(
        (r) =>
          r &&
          typeof r === "object" &&
          typeof r.start === "number" &&
          typeof r.end === "number" &&
          Number.isFinite(r.start) &&
          Number.isFinite(r.end) &&
          r.start >= 0 &&
          r.end > r.start,
      )
    )
      throw new QueryError("badRequest", "Invalid check ranges.");
    const { checkService } = await import("./service-check");
    return checkService(session, serviceRequest("check", input.request), input.ranges, signal);
  }
  if (operation === "relink") {
    if (
      !input ||
      typeof input !== "object" ||
      !("bytes" in input) ||
      !Array.isArray(input.bytes) ||
      !("name" in input) ||
      typeof input.name !== "string" ||
      !("mediaID" in input) ||
      typeof input.mediaID !== "string" ||
      input.bytes.length > 64 * 1024 * 1024 ||
      !input.bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    )
      throw new QueryError("badRequest", "Invalid relink resource.");
    signal.throwIfAborted();
    await session.relinkMedia(input.mediaID, new File([new Uint8Array(input.bytes)], input.name));
    return {
      revision: session.getSnapshot().revision,
      relinked: [input.mediaID],
      warnings: session.getSnapshot().warnings,
    };
  }
  const request = serviceRequest(operation, input),
    file = session.projectFile();
  signal.throwIfAborted();
  if (operation === "sync") {
    const { syncService } = await import("./service-sync");
    return syncService(session, request, signal);
  }
  if (
    operation.startsWith("assets-") ||
    ["segments", "save-segment", "insert-segment", "wait", "archive"].includes(operation)
  ) {
    const { libraryOperation } = await import("./service-library");
    return libraryOperation(session, operation, request, signal);
  }
  if (["frame", "frames", "clip", "export", "loudness"].includes(operation)) {
    const { renderService } = await import("./service-render");
    return renderService(session, operation, request, signal);
  }
  await session.analysis.prepareSpeech();
  signal.throwIfAborted();
  if (operation === "comments") {
    const { reviewQuery } = await import("@sidecut/core/service-review");
    return reviewQuery(file, operation, request, undefined, session.analysis.transcriptFor);
  }
  if (operation === "cards") {
    const { cardsService } = await import("./service-cards");
    return cardsService(session, request, signal);
  }
  if (operation === "transcribe") {
    return transcribeService(
      file,
      request,
      session.analysis,
      signal,
      () => session.getSnapshot().revision,
    );
  }

  try {
    if (["transcript", "search", "pauses"].includes(operation))
      return speechQuery(file, operation, request, session.analysis.transcriptFor);
    return helperPlan(file, operation, request, session.analysis.transcriptFor);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError("badRequest", error instanceof Error ? error.message : String(error));
  }
}
export function connectRendererOperations(session: BrowserProjectSession) {
  const native = session.native;
  if (!native?.serviceSubscribe || !native.serviceReply) return () => {};
  const jobs = new Map<string, AbortController>();
  const stop = native.serviceSubscribe((request) => {
    if (request.type === "cancel") {
      jobs.get(request.id)?.abort();
      return;
    }
    const controller = new AbortController();
    jobs.set(request.id, controller);
    void (async () => {
      const file = session.getSnapshot();
      if (file.project.id !== request.projectID || file.revision !== request.revision)
        throw new Error("Editor project changed before the request started.");
      const result = await rendererOperation(
        session,
        request.operation,
        request.input,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (
        session.getSnapshot().project.id !== request.projectID ||
        (!rendererMutations.has(request.operation) &&
          request.operation !== "wait" &&
          request.operation !== "transcribe" &&
          session.getSnapshot().revision !== request.revision)
      )
        throw new Error("Editor changed during the operation.");
      // Encode Time values before structured clone strips their JSON serialization.
      await native.serviceReply!(request.id, JSON.parse(JSON.stringify(result)));
    })()
      .catch((error) =>
        native.serviceReply!(
          request.id,
          null,
          JSON.stringify({
            code: error instanceof QueryError ? error.code : "unavailable",
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      )
      .finally(() => jobs.delete(request.id))
      .catch(() => {});
  });
  return () => {
    stop();
    for (const controller of jobs.values()) controller.abort();
    jobs.clear();
  };
}
