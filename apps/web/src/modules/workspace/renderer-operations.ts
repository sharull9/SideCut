import type { BrowserProjectSession } from "./browser-session";
import { serviceRequest, rendererMutations } from "@sidecut/core/service-requests";
import { speechQuery, helperPlan } from "@sidecut/core/service-speech";
import { mediaIDOf } from "@sidecut/core/speech";
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
  if (operation === "transcribe") {
    const references = request.media as string[];
    const ids = references.map(
      (ref) =>
        file.project.media.find(
          (m) => m.id === ref || m.path === ref || m.path.split(/[\\/]/).at(-1) === ref,
        )?.id ??
        [...file.project.videoTracks, ...file.project.audioTracks]
          .flatMap((t) => t.clips)
          .filter((c) => c.id === ref)
          .map(mediaIDOf)[0],
    );
    if (ids.some((id) => !id) || !ids.length)
      throw new QueryError("notFound", "A requested transcription source was not found.");
    const items = [...new Set(ids)].map((id) => file.project.media.find((m) => m.id === id)!);
    if (items.some((m) => !m.hasAudio))
      throw new QueryError("badRequest", "Transcription requires an audio source.");
    const jobs = items.map((item) =>
      session.analysis.transcribe(item.id, request.wait === true ? signal : undefined),
    );
    if (request.wait === true) await Promise.allSettled(jobs);
    else jobs.forEach((job) => void job.catch(() => {}));
    signal.throwIfAborted();
    const files = items.map((item) => {
      const state = session.analysis.getSnapshot()[item.id],
        transcript = session.analysis.transcriptFor(item);
      return {
        kind: "transcript",
        mediaID: item.id,
        path: item.path,
        state: transcript ? "ready" : state?.error ? "failed" : "queued",
        ...(transcript ? { words: transcript.words.length } : {}),
        ...(state?.error ? { message: state.error } : {}),
      };
    });
    return {
      revision: file.revision,
      files,
      headless: false,
      ...(request.wait === true
        ? { waited: { revision: file.revision, done: true, timedOut: false, items: files } }
        : {}),
    };
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
