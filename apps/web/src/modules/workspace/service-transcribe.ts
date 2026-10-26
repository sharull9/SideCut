import type { ProjectFile } from "@sidecut/contracts/project";
import type { BrowserProjectSession } from "./browser-session";
import { QueryError, clipMediaID } from "@sidecut/core/project-queries";

type Analysis = Pick<
  BrowserProjectSession["analysis"],
  "transcribe" | "transcriptFor" | "getSnapshot"
>;
export async function transcribeService(
  file: ProjectFile,
  request: Record<string, unknown>,
  analysis: Analysis,
  signal: AbortSignal,
  currentRevision: () => number,
) {
  signal.throwIfAborted();
  const refs = request.media as string[];
  if (!refs.length) throw new QueryError("badRequest", "Name the media to transcribe.");
  const ids = refs.map(
    (ref) =>
      file.project.media.find(
        (m) => m.id === ref || m.path === ref || m.path.split(/[\\/]/).at(-1) === ref,
      )?.id ??
      [...file.project.videoTracks, ...file.project.audioTracks]
        .flatMap((t) => t.clips)
        .filter((c) => c.id === ref)
        .map(clipMediaID)[0],
  );
  if (ids.some((id) => !id))
    throw new QueryError("notFound", "A requested transcription source was not found.");
  const items = [...new Set(ids)].map((id) => file.project.media.find((m) => m.id === id)!);
  if (items.some((m) => !m.hasAudio))
    throw new QueryError("badRequest", "Transcription requires an audio source.");
  const started = performance.now(),
    failures = new Map<string, string>(),
    settled = new Set<string>();
  const jobs = items.map((item) =>
    analysis
      .transcribe(item.id, request.wait === true ? signal : undefined)
      .catch((error: unknown) => {
        failures.set(item.id, error instanceof Error ? error.message : String(error));
      })
      .finally(() => settled.add(item.id)),
  );
  let timedOut = false;
  if (request.wait === true) {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(
        () => {
          timedOut = true;
          finish();
        },
        Math.min(86400, Math.max(0, Number(request.timeout ?? 600))) * 1000,
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void Promise.all(jobs).then(() => finish());
    });
  }
  signal.throwIfAborted();
  const files = items.map((item) => {
    const transcript = analysis.transcriptFor(item),
      state = analysis.getSnapshot()[item.id],
      message =
        failures.get(item.id) ??
        state?.error ??
        (settled.has(item.id) && !transcript
          ? "Transcription finished without a transcript."
          : undefined);
    return {
      kind: "transcript",
      mediaID: item.id,
      path: item.path,
      state: transcript ? "ready" : message ? "failed" : state?.status ? "running" : "queued",
      ...(transcript ? { words: transcript.words.length } : {}),
      ...(message && !transcript ? { message } : {}),
    };
  });
  const finished = files.filter((f) => ["ready", "failed"].includes(f.state)),
    pending = files.filter((f) => !["ready", "failed"].includes(f.state));
  return {
    revision: currentRevision(),
    ok: !files.some((f) => f.state === "failed") && (request.wait !== true || pending.length === 0),
    files,
    headless: false,
    ...(request.wait === true
      ? {
          waited: {
            what: "transcript",
            ok: pending.length === 0 && !finished.some((f) => f.state === "failed"),
            done: pending.length === 0,
            timedOut: timedOut && pending.length > 0,
            elapsed: (performance.now() - started) / 1000,
            finished,
            pending,
          },
        }
      : {}),
  };
}
